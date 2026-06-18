import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ImapFlow } from 'imapflow'
import * as nodemailer from 'nodemailer'
import { PrismaService } from '../prisma/prisma.service'
import { TelegramService } from '../telegram/telegram.service'

export interface InboxMessage {
	uid: number
	from: string
	fromAddress: string
	subject: string
	date: string
	text: string
	isFromOutreach: boolean
	outreachDomain?: string
	outreachLeadId?: string
}

@Injectable()
export class InboxService implements OnModuleInit, OnModuleDestroy {
	private lastNotifiedUid = 0
	private timer: NodeJS.Timeout | null = null

	constructor(
		private config: ConfigService,
		private prisma: PrismaService,
		private telegram: TelegramService,
	) {}

	onModuleInit() {
		// При старте инициализируем lastNotifiedUid текущим максимумом — не слать старые письма
		setTimeout(async () => {
			try {
				const msgs = await this.fetchInbox(10)
				if (msgs.length > 0) this.lastNotifiedUid = Math.max(...msgs.map(m => m.uid))
			} catch {}
			this.timer = setInterval(() => this.checkNewAndNotify(), 5 * 60 * 1000)
		}, 30_000)
	}

	onModuleDestroy() {
		if (this.timer) clearInterval(this.timer)
	}

	private isBounce(m: InboxMessage) {
		const from = m.fromAddress.toLowerCase()
		const subj = m.subject.toLowerCase()
		return from.includes('mailer-daemon') || from.includes('postmaster') ||
			subj.includes('delivery') || subj.includes('undelivered') || subj.includes('returned mail')
	}

	private async checkNewAndNotify() {
		try {
			const msgs = await this.fetchInbox(30)
			const newMsgs = msgs.filter(m => m.uid > this.lastNotifiedUid && !this.isBounce(m))
			if (newMsgs.length === 0) return

			this.lastNotifiedUid = Math.max(...newMsgs.map(m => m.uid))

			for (const m of newMsgs) {
				const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
				const tag = m.isFromOutreach
					? `📬 <b>Ответ от лида</b> (${esc(m.outreachDomain ?? '')})`
					: '📧 <b>Новое письмо</b>'
				const body = m.text
					? esc(m.text.replace(/\r\n/g, '\n').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').slice(0, 600))
					: ''
				const text = [
					tag,
					`От: ${esc(m.from)} &lt;${esc(m.fromAddress)}&gt;`,
					`Тема: ${esc(m.subject)}`,
					body ? `\n${body}` : '',
				].join('\n')
				await this.telegram.sendAdminNotification(text, 360)
			}
		} catch {}
	}

	private makeClient() {
		const port = Number(this.config.get('IMAP_PORT') || 993)
		const secure = port === 993
		return new ImapFlow({
			host: this.config.get('IMAP_HOST') || 'imap.beget.com',
			port,
			secure,
			auth: {
				user: this.config.get('SMTP_USER') || 'info@skyseo.site',
				pass: this.config.get('SMTP_PASS') || '',
			},
			logger: false,
			tls: { rejectUnauthorized: false },
			connectionTimeout: 10000,
			socketTimeout: 15000,
			// Отключаем STARTTLS для туннеля (plain TCP → TLS на хосте)
			disableCompression: true,
		} as any)
	}

	async fetchInbox(limit = 50): Promise<InboxMessage[]> {
		const client = this.makeClient()
		const timer = setTimeout(() => client.close(), 15000)
		try {
			return await this._fetchInbox(limit, client)
		} finally {
			clearTimeout(timer)
		}
	}

	private async _fetchInbox(limit = 50, client?: ReturnType<InboxService['makeClient']>): Promise<InboxMessage[]> {
		if (!client) client = this.makeClient()
		// Получаем все email-адреса из outreach_leads для матчинга
		const leads = await this.prisma.outreachLead.findMany({
			select: { id: true, domain: true, email: true },
			where: { email: { not: null } },
		})
		const emailToLead = new Map<string, { id: string; domain: string }>()
		for (const l of leads) {
			if (l.email) emailToLead.set(l.email.toLowerCase().trim(), { id: l.id, domain: l.domain })
		}

		const messages: InboxMessage[] = []

		try {
			await client.connect()
			const lock = await client.getMailboxLock('INBOX')
			try {
				const status = await client.status('INBOX', { messages: true })
				const total = status.messages ?? 0

				if (total === 0) return []

				const start = Math.max(1, total - limit + 1)
				for await (const msg of client.fetch(`${start}:*`, {
					uid: true,
					envelope: true,
					source: true,
				})) {
					try {
						const from = msg.envelope?.from?.[0]
						const fromAddr = from?.address?.toLowerCase() ?? ''
						const fromName = from?.name || fromAddr
						const subject = msg.envelope?.subject ?? '(без темы)'
						const date = msg.envelope?.date?.toISOString() ?? ''

						let text = ''
						if (msg.source) {
							const src = msg.source as unknown as Buffer
							const raw = src.toString('utf-8')
							const bodyStart = raw.indexOf('\r\n\r\n')
							text = (bodyStart >= 0 ? raw.slice(bodyStart + 4) : raw).slice(0, 2000)
						}

						const lead = emailToLead.get(fromAddr)
						messages.push({
							uid: msg.uid,
							from: fromName,
							fromAddress: fromAddr,
							subject,
							date,
							text,
							isFromOutreach: !!lead,
							outreachDomain: lead?.domain,
							outreachLeadId: lead?.id,
						})
					} catch {}
				}
			} finally {
				lock.release()
			}
		} finally {
			await client.logout().catch(() => {})
		}

		return messages.reverse().filter(m => !this.isBounce(m))
	}

	async replyToEmail(to: string, subject: string, text: string) {
		const transport = nodemailer.createTransport({
			host: this.config.get('SMTP_HOST') || 'smtp.beget.com',
			port: Number(this.config.get('SMTP_PORT') || 2525),
			secure: false,
			auth: {
				user: this.config.get('SMTP_USER') || 'info@skyseo.site',
				pass: this.config.get('SMTP_PASS') || '',
			},
		})
		await transport.sendMail({
			from: this.config.get('SMTP_FROM') || 'info@skyseo.site',
			to,
			subject: subject.startsWith('Re:') ? subject : `Re: ${subject}`,
			text,
		})
	}
}
