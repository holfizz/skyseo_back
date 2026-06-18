import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ImapFlow } from 'imapflow'
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
		// Первый запуск через 30 сек после старта, потом каждые 5 мин
		setTimeout(() => {
			this.checkNewAndNotify()
			this.timer = setInterval(() => this.checkNewAndNotify(), 5 * 60 * 1000)
		}, 30_000)
	}

	onModuleDestroy() {
		if (this.timer) clearInterval(this.timer)
	}

	private async checkNewAndNotify() {
		try {
			const msgs = await this.fetchInbox(30)
			const newMsgs = msgs.filter(m => m.uid > this.lastNotifiedUid)
			if (newMsgs.length === 0) return

			this.lastNotifiedUid = Math.max(...newMsgs.map(m => m.uid))

			for (const m of newMsgs) {
				const tag = m.isFromOutreach ? `📬 *Ответ от лида* (${m.outreachDomain})` : '📧 *Новое письмо*'
				const text = [
					tag,
					`От: ${m.from} <${m.fromAddress}>`,
					`Тема: ${m.subject}`,
					m.text ? `\n${m.text.slice(0, 800)}` : '',
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
			console.log('[Inbox] connecting...')
			await client.connect()
			console.log('[Inbox] connected, getting lock...')
			const lock = await client.getMailboxLock('INBOX')
			try {
				const status = await client.status('INBOX', { messages: true })
				const total = status.messages ?? 0
				if (total === 0) return []

				const start = Math.max(1, total - limit + 1)
				for await (const msg of client.fetch(`${start}:*`, {
					uid: true,
					envelope: true,
					bodyStructure: true,
					source: false,
				})) {
					try {
						const from = msg.envelope?.from?.[0]
						const fromAddr = from?.address?.toLowerCase() ?? ''
						const fromName = from?.name || fromAddr
						const subject = msg.envelope?.subject ?? '(без темы)'
						const date = msg.envelope?.date?.toISOString() ?? ''

						// Получаем текст письма
						let text = ''
						try {
							const { content } = await client.download(String(msg.seq), '1')
							const chunks: Buffer[] = []
							for await (const chunk of content) chunks.push(chunk)
							text = Buffer.concat(chunks).toString('utf-8').slice(0, 2000)
						} catch {}

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

		return messages.reverse()
	}
}
