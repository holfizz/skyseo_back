import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../prisma/prisma.service'
import { SiteLeadDto } from './dto/site-lead.dto'
import { validateLeadSite, normalizeLeadTelegram } from './site-lead.validation'

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
        const { domain, error } = validateLeadSite(dto.site ?? '')
        if (error) throw new BadRequestException(error)
        const telegram = normalizeLeadTelegram(dto.telegram ?? '')
        if (!telegram) throw new BadRequestException('Укажите Telegram: @username или ссылку t.me/username')

		const auto = !!dto.auto

		await this.prisma.outreachLead.create({
			data: {
				domain,
				telegram,
				phone: null,
				// Заявка с Telegram сразу попадает в очередь менеджеру.
				telegramManual: true,
				channel: auto ? 'Автосохранение с сайта' : 'Заявка с сайта',
				status: 'NEW',
				message: auto
					? 'Автосохранение: форму заполнили, но не отправили'
					: 'Заявка с сайта: бесплатный тест сайта',
				notes: auto
					? 'Автосохранение: данные заполнены на сайте, но кнопку «Отправить» не нажали'
					: 'Оставил заявку через форму на сайте',
			},
		})

		// Пинг владельцу — не роняем заявку, если телега молчит.
		this.notifyAdmin({ domain, telegram, auto }).catch(e =>
			this.log.warn(`Не отправил уведомление о заявке: ${e}`),
		)

		return { ok: true }
	}

	private async notifyAdmin(l: { domain: string; telegram: string; auto: boolean }) {
		const token = this.config.get<string>('TELEGRAM_BOT_TOKEN')
		const chatId = this.config.get<string>('TELEGRAM_ADMIN_ID')
		if (!token || token.length < 20 || token === 'dummy-token' || !chatId) return

		const head = l.auto
			? '🟡 <b>Автосохранение</b> — форму заполнили, но не отправили'
			: '🆕 <b>Заявка с сайта</b> — бесплатный тест'
		const text =
			`${head}\n` +
			`🌐 https://${l.domain}\n` +
			`✈️ Telegram: ${l.telegram}`

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
