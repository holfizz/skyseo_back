import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { NotificationsService } from '../notifications/notifications.service'
import { OutreachLead, OutreachStatus, Prisma } from '@prisma/client'
import { newReportToken } from './outreach-import.service'
import { fetchVolumes } from './outreach-wordstat'
import { buildOpeningMessage, buildOutreachMessage, MESSAGE_POSITION_MAX, MESSAGE_POSITION_MIN, MessageCompetitor, MessageKeyword, sumShownVolume } from './outreach-message'

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

	async getLeads(params: {
		status?: OutreachStatus
		search?: string
		importId?: string
		hasTelegram?: boolean
		hasInn?: boolean
		sort?: 'score' | 'createdAt'
		page?: number
		limit?: number
	} = {}) {
		const where: Prisma.OutreachLeadWhereInput = {}
		if (params.status) where.status = params.status
		if (params.importId) where.importId = params.importId
		if (params.search) {
			where.OR = [
				{ domain: { contains: params.search, mode: 'insensitive' } },
				{ contact: { contains: params.search, mode: 'insensitive' } },
			]
		}
		// В базе есть лиды из старых xlsx-импортов с пустой строкой вместо null
		const and: Prisma.OutreachLeadWhereInput[] = []
		if (params.hasTelegram) and.push({ telegram: { not: null } }, { NOT: { telegram: '' } })
		if (params.hasInn) and.push({ inn: { not: null } }, { NOT: { inn: '' } })
		if (and.length > 0) where.AND = and

		const page = Math.max(Number(params.page) || 1, 1)
		const limit = Math.min(Math.max(Number(params.limit) || 100, 1), 500)
		const orderBy: Prisma.OutreachLeadOrderByWithRelationInput[] =
			params.sort === 'score' ? [{ score: 'desc' }, { createdAt: 'desc' }] : [{ createdAt: 'desc' }]

		const [items, total] = await Promise.all([
			this.prisma.outreachLead.findMany({ where, orderBy, skip: (page - 1) * limit, take: limit }),
			this.prisma.outreachLead.count({ where }),
		])
		return { items, total, page, limit }
	}

	// Правка лида руками из админки: ФИО, контакты, статус, заметки.
	// ФИО автоматом никто не заполняет — только здесь, поэтому после его правки
	// пересобираем сохранённый текст сообщения (обращение меняется).
	async updateLead(
		id: string,
		body: {
			firstName?: string | null
			lastName?: string | null
			middleName?: string | null
			companyName?: string | null
			city?: string | null
			phone?: string | null
			whatsapp?: string | null
			telegram?: string | null
			email?: string | null
			contact?: string | null
			inn?: string | null
			status?: OutreachStatus
			notes?: string | null
		},
	) {
		const fields = [
			'firstName', 'lastName', 'middleName', 'companyName', 'city',
			'phone', 'whatsapp', 'telegram', 'email', 'contact', 'inn', 'notes',
		] as const
		const data: Prisma.OutreachLeadUncheckedUpdateInput = {}
		for (const key of fields) {
			if (body[key] !== undefined) (data as any)[key] = body[key]?.toString().trim() || null
		}
		// Правка телеграма руками — единственный способ разрешить его менеджеру.
		// Очистили поле — признак снимаем, иначе пустой «ручной» контакт остался бы
		// в очереди и менеджер увидел бы карточку, которую некому отправить.
		if (body.telegram !== undefined) {
			data.telegramManual = !!(body.telegram?.toString().trim())
		}
		if (body.status !== undefined) {
			data.status = body.status
			if (body.status === 'CONTACTED') data.contactedAt = new Date()
		}

		const lead = await this.prisma.outreachLead.update({ where: { id }, data })
		if (body.firstName === undefined && body.middleName === undefined) return lead
		return this.prisma.outreachLead.update({
			where: { id },
			data: { message: await this.buildMessage(lead) },
		})
	}

	// Текст холодного сообщения по шаблону (см. outreach-message.ts).
	//
	// Пересобранный текст сразу кладём в лида. Иначе в карточке виден свежий вариант,
	// а в списке, выгрузке и письме — тот, что записался на импорте: после правки
	// шаблона они расходятся, и менеджер отправляет устаревшую формулировку.
	async getMessage(id: string) {
		const lead = await this.prisma.outreachLead.findUniqueOrThrow({ where: { id } })
		const message = await this.buildMessage(lead)
		if (message !== lead.message) {
			await this.prisma.outreachLead.update({ where: { id }, data: { message } })
		}
		return { message }
	}

	/**
	 * Открывающее сообщение — первое касание. В лиде не храним: оно короткое,
	 * собирается из тех же данных и нужно ровно один раз, перед отправкой.
	 */
	async getOpeningMessage(id: string) {
		const lead = await this.prisma.outreachLead.findUniqueOrThrow({ where: { id } })
		const keywords = await this.leadKeywords(lead)
		return {
			message: buildOpeningMessage({
				domain: lead.domain,
				firstName: lead.firstName,
				middleName: lead.middleName,
				keywords,
				competitors: [],
			}),
		}
	}

	/**
	 * Пересобрать тексты у всех лидов по текущему шаблону.
	 *
	 * Идём последовательно, а не через Promise.all: buildMessage дёргает Вордстат,
	 * и параллельный залп по всей базе упрётся в лимиты XMLRiver. Лидов десятки,
	 * так что скорость здесь не важна.
	 */
	async rebuildMessages() {
		const leads = await this.prisma.outreachLead.findMany({ orderBy: { createdAt: 'asc' } })
		let updated = 0
		for (const lead of leads) {
			const message = await this.buildMessage(lead)
			if (message === lead.message) continue
			await this.prisma.outreachLead.update({ where: { id: lead.id }, data: { message } })
			updated++
		}
		return { total: leads.length, updated }
	}

	/** Ключи лида с лучшими позициями — из выдачи того прогона, откуда он пришёл. */
	private async leadKeywords(lead: OutreachLead): Promise<MessageKeyword[]> {
		if (!lead.importId) return []
		const rows = await this.prisma.serpRow.findMany({
			where: { importId: lead.importId, domain: lead.domain },
			orderBy: { position: 'asc' },
			select: { keyword: true, position: true },
		})
		// rows отсортированы по возрастанию, поэтому первая строка ключа — лучшая позиция.
		// Фильтруем ИМЕННО по лучшей, а не в SQL: в старых прогонах выдача бралась
		// без группировки по домену, и один сайт занимал по ключу десятки строк.
		// Отбор в запросе выбрал бы из них строку в окне и написал «вы на 17 месте»
		// тому, кто по этому же ключу стоит первым.
		const best = new Map<string, MessageKeyword>()
		for (const r of rows) if (!best.has(r.keyword)) best.set(r.keyword, r)
		return Array.from(best.values()).filter(
			k => k.position >= MESSAGE_POSITION_MIN && k.position <= MESSAGE_POSITION_MAX,
		)
	}

	private async buildMessage(lead: OutreachLead): Promise<string> {
		const keywords = await this.leadKeywords(lead)
		const competitors = (Array.isArray(lead.competitors) ? lead.competitors : []) as MessageCompetitor[]

		// Токен у старых лидов мог не проставиться при заведении — выдаём при первом обращении.
		let token = lead.reportToken
		if (!token) {
			token = newReportToken()
			await this.prisma.outreachLead.update({ where: { id: lead.id }, data: { reportToken: token } })
		}

		const imp = lead.importId
			? await this.prisma.serpImport.findUnique({ where: { id: lead.importId }, select: { region: true } })
			: null
		const volumes = await fetchVolumes(
			keywords.map(k => k.keyword),
			imp?.region ?? null,
		)

		return buildOutreachMessage({
			domain: lead.domain,
			firstName: lead.firstName,
			middleName: lead.middleName,
			keywords,
			competitors,
			volume: sumShownVolume(keywords, volumes),
		})
	}

	// Публичная ссылка на отчёт: первое открытие фиксируем датой, дальше просто считаем.
	async registerReportOpen(token: string) {
		const lead = await this.prisma.outreachLead.findUnique({ where: { reportToken: token } })
		if (!lead) throw new NotFoundException('Отчёт не найден')
		await this.prisma.outreachLead.update({
			where: { id: lead.id },
			data: {
				reportOpens: { increment: 1 },
				reportOpenedAt: lead.reportOpenedAt ?? new Date(),
			},
		})
		return lead
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
