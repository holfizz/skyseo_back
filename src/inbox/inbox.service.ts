import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ImapFlow } from 'imapflow'
import * as nodemailer from 'nodemailer'
import OpenAI from 'openai'
import { PrismaService } from '../prisma/prisma.service'
import { TelegramService } from '../telegram/telegram.service'

export interface InboxMessage {
	uid: number
	from: string
	fromAddress: string
	subject: string
	date: string
	text: string
	isHtml: boolean
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

	private decodePart(raw: string, contentType: 'text/plain' | 'text/html'): string {
		const partMatch = raw.match(
			new RegExp(`Content-Type:\\s*${contentType.replace('/', '\\/')}[^\\r\\n]*\\r?\\n(?:[^\\r\\n]+\\r?\\n)*?\\r?\\n([\\s\\S]*?)(?:\\r?\\n--|$)`, 'i'),
		)
		if (!partMatch) return ''
		const encSearch = raw.slice(raw.search(new RegExp(`Content-Type:\\s*${contentType.replace('/', '\\/')}`, 'i')))
		const encMatch = encSearch.match(/Content-Transfer-Encoding:\s*(\S+)/i)
		const enc = encMatch?.[1]?.toLowerCase() ?? 'plain'
		const body = partMatch[1].trim()
		if (enc === 'base64') {
			try { return Buffer.from(body.replace(/\s/g, ''), 'base64').toString('utf-8') } catch { return body }
		}
		if (enc === 'quoted-printable') {
			return body.replace(/=\r?\n/g, '').replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
		}
		return body
	}

	private decodeMimeText(raw: string): { plain: string; html: string; isHtml: boolean } {
		// multipart: find text/plain and text/html parts
		const hasPlainPart = /Content-Type:\s*text\/plain/i.test(raw)
		const hasHtmlPart = /Content-Type:\s*text\/html/i.test(raw)

		if (hasPlainPart || hasHtmlPart) {
			const plain = hasPlainPart ? this.decodePart(raw, 'text/plain') : ''
			const html = hasHtmlPart ? this.decodePart(raw, 'text/html') : ''
			return { plain, html, isHtml: !plain && !!html }
		}

		// single-part: headers + blank line + body
		const encMatch = raw.match(/Content-Transfer-Encoding:\s*(\S+)/i)
		const enc = encMatch?.[1]?.toLowerCase() ?? 'plain'
		const bodyStart = raw.indexOf('\r\n\r\n')
		const body = (bodyStart >= 0 ? raw.slice(bodyStart + 4) : raw).trim()

		let decoded = body
		if (enc === 'base64') {
			try { decoded = Buffer.from(body.replace(/\s/g, ''), 'base64').toString('utf-8') } catch {}
		} else if (enc === 'quoted-printable') {
			decoded = body.replace(/=\r?\n/g, '').replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
		}

		const looksHtml = /^\s*<!?[Dd][Oo][Cc][Tt][Yy][Pp][Ee]|^\s*<[Hh][Tt][Mm][Ll]/m.test(decoded)
		return looksHtml ? { plain: '', html: decoded, isHtml: true } : { plain: decoded, html: '', isHtml: false }
	}

	private async checkNewAndNotify() {
		try {
			const msgs = await this.fetchInbox(30)
			const newMsgs = msgs.filter(m => m.uid > this.lastNotifiedUid && !this.isBounce(m))
			if (newMsgs.length === 0) return

			this.lastNotifiedUid = Math.max(...newMsgs.map(m => m.uid))

			for (const m of newMsgs) {
				const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

				const bodyText = (m.isHtml ? '' : (m.text || '')).replace(/\r\n/g, '\n').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').trim()

				// ищем юзера в системе по email
				const sysUser = await this.prisma.user.findFirst({
					where: { email: m.fromAddress.toLowerCase().trim() },
					select: { id: true, balance: true, websites: { select: { url: true } } },
				}).catch(() => null)

				const tag = m.isFromOutreach
					? `📬 <b>Ответ от лида</b> · ${esc(m.outreachDomain ?? '')}`
					: '📧 <b>Новое письмо</b>'

				const sysLine = sysUser
					? `👤 В системе: баланс ${sysUser.balance} · сайтов ${sysUser.websites.length}`
					: '👤 Не зарегистрирован'

				const leadLine = m.outreachLeadId
					? `🔗 <a href="https://i.skyseo.site/holfizz/outreach/${m.outreachLeadId}">открыть лид</a>`
					: ''

				const inboxLink = `🔗 <a href="https://i.skyseo.site/holfizz/inbox">открыть письмо</a>`

				const bodyLine = m.isHtml
					? `(HTML-письмо — ${inboxLink})`
					: bodyText ? esc(bodyText.slice(0, 500)) : ''

				const parts = [
					tag,
					`От: ${esc(m.from)} &lt;${esc(m.fromAddress)}&gt;`,
					`Тема: ${esc(m.subject)}`,
					sysLine,
					leadLine,
					bodyLine ? `\n${bodyLine}` : '',
				].filter(Boolean)

				await this.telegram.sendAdminNotification(parts.join('\n'), 360)
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
						let isHtml = false
						if (msg.source) {
							const src = msg.source as unknown as Buffer
							const raw = src.toString('utf-8').slice(0, 30000)
							const decoded = this.decodeMimeText(raw)
							isHtml = decoded.isHtml
							text = isHtml ? decoded.html.slice(0, 10000) : decoded.plain.slice(0, 5000)
						}

						const lead = emailToLead.get(fromAddr)
						messages.push({
							uid: msg.uid,
							from: fromName,
							fromAddress: fromAddr,
							subject,
							date,
							text,
							isHtml,
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

	async generateAiReply(data: {
		fromAddress: string
		fromName: string
		subject: string
		text: string
		isFromOutreach: boolean
		outreachDomain?: string
	}): Promise<string> {
		const user = await this.prisma.user.findFirst({
			where: { email: data.fromAddress.toLowerCase().trim() },
			select: { id: true, email: true, balance: true, websites: { select: { url: true } } },
		})

		let systemContext: string
		if (user) {
			systemContext = `Данные о пользователе в системе SkySEO:\n- Email: ${user.email}\n- Баланс: ${user.balance} баллов\n- Сайтов добавлено: ${user.websites.length}${user.websites.length > 0 ? '\n- Сайты: ' + user.websites.map(w => w.url).join(', ') : ''}`
		} else {
			systemContext = 'Пользователь НЕ зарегистрирован в системе SkySEO. Упомяни, что можно попробовать бесплатно на skyseo.site.'
		}

		const outreachNote = data.isFromOutreach && data.outreachDomain
			? `Это лид из нашей рассылки (домен: ${data.outreachDomain}).`
			: ''

		const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
		const response = await openai.chat.completions.create({
			model: 'gpt-4o-mini',
			messages: [
				{
					role: 'system',
					content: `Ты — менеджер SEO-сервиса SkySEO. Помогаешь сайтам продвигаться в Яндексе и Google через поведенческие факторы. ${outreachNote}\n${systemContext}\n\nНапиши вежливый, живой ответ на письмо. Если есть данные о пользователе — используй их (баланс, сайты). Если нет — коротко пригласи зарегистрироваться. До 120 слов, без лишних формальностей.`,
				},
				{
					role: 'user',
					content: `От: ${data.fromName} <${data.fromAddress}>\nТема: ${data.subject}\n\n${(data.text || '').slice(0, 1000)}`,
				},
			],
			max_tokens: 400,
			temperature: 0.7,
		})

		return response.choices[0]?.message?.content?.trim() || ''
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
