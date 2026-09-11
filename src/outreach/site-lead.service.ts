import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../prisma/prisma.service'
import { SiteLeadDto } from './dto/site-lead.dto'

/**
 * Приём заявок с формы на сайте («бесплатный тест сайта»).
 *
 * Пишем в ту же таблицу лидов, что и парсер, но помечаем каналом «Заявка с
 * сайта». Если человек оставил телеграм — ставим telegramManual, чтобы лид
 * сразу попал в очередь менеджеру (см. OutreachLead.telegramManual). Плюс
 * шлём владельцу пинг в Telegram напрямую через HTTP API того же бота —
 * без второго инстанса Telegraf.
 */
@Injectable()
export class SiteLeadService {
	private readonly log = new Logger('SiteLead')

	constructor(private prisma: PrismaService, private config: ConfigService) {}

	async create(dto: SiteLeadDto) {
		const telegram = normalizeTg(dto.telegram)
		const phone = normalizePhone(dto.phone)
		const domain = toDomain(dto.site ?? '')

		if (!domain) throw new BadRequestException('Укажите адрес сайта')
		if (!telegram && !phone)
			throw new BadRequestException('Оставьте телеграм или телефон, чтобы мы могли ответить')

		await this.prisma.outreachLead.create({
			data: {
				domain,
				telegram: telegram || null,
				phone: phone || null,
				// Есть телеграм — сразу в очередь менеджеру; иначе просто лид с телефоном.
				telegramManual: !!telegram,
				channel: 'Заявка с сайта',
				status: 'NEW',
				message: 'Заявка с сайта: бесплатный тест сайта',
				notes: 'Оставил заявку через форму на сайте',
			},
		})

		// Пинг владельцу — не роняем заявку, если телега молчит.
		this.notifyAdmin({ domain, telegram, phone }).catch(e =>
			this.log.warn(`Не отправил уведомление о заявке: ${e}`),
		)

		return { ok: true }
	}

	private async notifyAdmin(l: { domain: string; telegram: string | null; phone: string | null }) {
		const token = this.config.get<string>('TELEGRAM_BOT_TOKEN')
		const chatId = this.config.get<string>('TELEGRAM_ADMIN_ID')
		if (!token || token.length < 20 || token === 'dummy-token' || !chatId) return

		const text =
			`🆕 <b>Заявка с сайта</b> — бесплатный тест\n` +
			`🌐 https://${l.domain}\n` +
			`✈️ Telegram: ${l.telegram ?? '—'}\n` +
			`📞 Телефон: ${l.phone ?? '—'}`

		await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				chat_id: chatId,
				text,
				parse_mode: 'HTML',
				disable_web_page_preview: true,
			}),
		})
	}
}

/** Телеграм: @username / username / ссылка t.me → «@username»; иначе как есть. */
function normalizeTg(v?: string): string | null {
	const s = (v ?? '').trim()
	if (!s) return null
	if (/^https?:\/\/t\.me\//i.test(s))
		return '@' + s.replace(/^https?:\/\/t\.me\//i, '').replace(/\/+$/, '')
	if (s.startsWith('@')) return s
	if (/^[a-zA-Z0-9_]{4,}$/.test(s)) return '@' + s
	return s
}

/** Телефон: должно быть хотя бы 10 цифр; храним как ввели (с маской). */
function normalizePhone(v?: string): string | null {
	const s = (v ?? '').trim()
	if (!s) return null
	return s.replace(/\D/g, '').length >= 10 ? s : null
}

/** Из введённого сайта достаём голый домен: без протокола, www, пути и параметров. */
function toDomain(site: string): string {
	const s = site
		.trim()
		.replace(/^https?:\/\//i, '')
		.replace(/^www\./i, '')
		.split('/')[0]
		.split('?')[0]
		.trim()
	return s
}
