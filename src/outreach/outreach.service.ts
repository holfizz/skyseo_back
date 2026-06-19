import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { NotificationsService } from '../notifications/notifications.service'
import { OutreachStatus } from '@prisma/client'

@Injectable()
export class OutreachService {
	constructor(
		private prisma: PrismaService,
		private notifications: NotificationsService,
	) {}

	async importLeads(rows: any[]) {
		let created = 0
		let skipped = 0
		for (const row of rows) {
			const domain = row.domain?.toString().trim()
			if (!domain) continue
			const existing = await this.prisma.outreachLead.findFirst({ where: { domain } })
			if (existing) { skipped++; continue }
			await this.prisma.outreachLead.create({
				data: {
					domain,
					contact: row.contact || null,
					channel: row.channel || null,
					phone: row.phone || null,
					whatsapp: row.whatsapp || null,
					telegram: row.telegram || null,
					email: row.email || null,
					keywords: row.keywords || null,
					message: row.message || '',
				},
			})
			created++
		}
		return { created, skipped }
	}

	async getLeadById(id: string) {
		const lead = await this.prisma.outreachLead.findUniqueOrThrow({ where: { id } })
		// ищем юзера в системе по email
		const user = lead.email
			? await this.prisma.user.findFirst({
				where: { email: lead.email.toLowerCase().trim() },
				select: { id: true, email: true, balance: true, createdAt: true, websites: { select: { id: true, url: true, name: true, isActive: true } } },
			}).catch(() => null)
			: null
		return { ...lead, systemUser: user ?? null }
	}

	async getLeads(status?: OutreachStatus, search?: string) {
		const where: any = {}
		if (status) where.status = status
		if (search) {
			where.OR = [
				{ domain: { contains: search, mode: 'insensitive' } },
				{ contact: { contains: search, mode: 'insensitive' } },
			]
		}
		return this.prisma.outreachLead.findMany({
			where,
			orderBy: { createdAt: 'desc' },
		})
	}

	async setStatus(id: string, status: OutreachStatus, notes?: string) {
		const data: any = { status }
		if (notes !== undefined) data.notes = notes
		if (status === 'CONTACTED') data.contactedAt = new Date()
		return this.prisma.outreachLead.update({ where: { id }, data })
	}

	async sendEmail(id: string, text?: string) {
		const lead = await this.prisma.outreachLead.findUniqueOrThrow({ where: { id } })
		if (!lead.email) throw new Error('Нет email')
		try {
			await this.notifications.sendRawEmail(
				lead.email,
				'SkySEO — поднимите сайт в топ Яндекса',
				text ?? lead.message,
			)
		} catch (err: any) {
			throw new Error(`SMTP ошибка: ${err.message}`)
		}
		await this.prisma.outreachLead.update({
			where: { id },
			data: {
				emailsSent: { increment: 1 },
				contactedAt: lead.contactedAt ?? new Date(),
				contactedVia: 'email',
				status: lead.status === 'NEW' ? 'CONTACTED' : lead.status,
			},
		})
		return { ok: true }
	}

	async trackTgClick(id: string) {
		const lead = await this.prisma.outreachLead.findUniqueOrThrow({ where: { id } })
		await this.prisma.outreachLead.update({
			where: { id },
			data: {
				tgLinkClicked: { increment: 1 },
				contactedAt: lead.contactedAt ?? new Date(),
				contactedVia: 'tg',
				status: lead.status === 'NEW' ? 'CONTACTED' : lead.status,
			},
		})
		return { ok: true }
	}

	async getStats() {
		const todayStart = new Date()
		todayStart.setHours(0, 0, 0, 0)
		const [total, byStatus, emailsSent, tgClicked, sentToday] = await Promise.all([
			this.prisma.outreachLead.count(),
			this.prisma.outreachLead.groupBy({ by: ['status'], _count: { _all: true } }),
			this.prisma.outreachLead.aggregate({ _sum: { emailsSent: true } }),
			this.prisma.outreachLead.aggregate({ _sum: { tgLinkClicked: true } }),
			this.prisma.outreachLead.count({ where: { contactedAt: { gte: todayStart }, contactedVia: 'email' } }),
		])
		const counts: Record<string, number> = {}
		for (const row of byStatus) counts[row.status] = row._count._all
		return {
			total,
			byStatus: counts,
			emailsSent: emailsSent._sum.emailsSent ?? 0,
			tgClicked: tgClicked._sum.tgLinkClicked ?? 0,
			sentToday,
		}
	}

	async moveStaleToDraft() {
		const threshold = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
		const { count } = await this.prisma.outreachLead.updateMany({
			where: {
				status: 'CONTACTED',
				contactedAt: { lte: threshold },
			},
			data: { status: 'DRAFT' },
		})
		return count
	}

	async deleteLead(id: string) {
		return this.prisma.outreachLead.delete({ where: { id } })
	}

	async bulkDeleteLeads(ids: string[]) {
		const { count } = await this.prisma.outreachLead.deleteMany({ where: { id: { in: ids } } })
		return count
	}

	async getConversions() {
		// Матчим outreach_leads.domain с websites.url по вхождению домена
		// Например: lead.domain = "fastweb.ru", website.url = "https://fastweb.ru" → совпадение
		const rows = await this.prisma.$queryRaw<any[]>`
			SELECT
				ol.id,
				ol.domain       AS lead_domain,
				ol.status       AS lead_status,
				ol."contactedAt",
				ol."contactedVia",
				ol.channel,
				ol.contact,
				w.id            AS website_id,
				w.url           AS website_url,
				w."createdAt"   AS website_created_at,
				u.email         AS user_email,
				u.id            AS user_id
			FROM outreach_leads ol
			JOIN websites w ON (
				w.url ILIKE '%' || regexp_replace(ol.domain, '^www\\.', '') || '%'
				OR ol.domain ILIKE '%' || regexp_replace(
					regexp_replace(w.url, '^https?://', ''),
					'/.*$', ''
				) || '%'
			)
			JOIN users u ON u.id = w."userId"
			ORDER BY w."createdAt" DESC
		`
		return rows.map(r => ({
			leadId:          r.id,
			leadDomain:      r.lead_domain,
			leadStatus:      r.lead_status,
			contactedAt:     r.contactedat,
			contactedVia:    r.contactedvia,
			channel:         r.channel,
			contact:         r.contact,
			websiteId:       r.website_id,
			websiteUrl:      r.website_url,
			websiteCreatedAt: r.website_created_at,
			userEmail:       r.user_email,
			userId:          r.user_id,
		}))
	}
}
