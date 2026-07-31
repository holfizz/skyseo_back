import { Injectable, OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Telegraf } from 'telegraf'

/**
 * Отдельный Telegram-бот CRM (TELEGRAM_CRM_BOT_TOKEN). Открывает Mini App и шлёт
 * напоминания сотрудникам. Не путать с админским и с notify-ботом — разные токены.
 *
 * Polling (bot.launch) и глобальная кнопка-меню включаются ТОЛЬКО в проде: иначе
 * дев и прод на одном токене конфликтуют (getUpdates 409), а setChatMenuButton
 * из дева перезаписал бы прод-URL меню на localhost. sendMessage работает всегда.
 */
@Injectable()
export class CrmBotService implements OnModuleDestroy {
	private bot: Telegraf | null = null
	private isEnabled = false
	private botUsername = 'skyseo_crm_bot'

	constructor(private config: ConfigService) {
		if (this.config.get('CRM_ENABLED') === 'false') {
			console.log('⛔ CRM выключена (CRM_ENABLED=false) — бот не запускается')
			return
		}
		const token = this.config.get<string>('TELEGRAM_CRM_BOT_TOKEN')
		if (token && token !== 'dummy-token' && token.length >= 20) {
			this.init(token)
		} else {
			console.log('⚠️ CRM-bot disabled (нет TELEGRAM_CRM_BOT_TOKEN)')
		}
	}

	private async init(token: string) {
		const isProd = this.config.get('NODE_ENV') === 'production'
		const webAppUrl = this.config.get<string>('CRM_WEBAPP_URL') || 'https://crm.skyseo.site'
		try {
			this.bot = new Telegraf(token)

			this.bot.start(async ctx => {
				await ctx.reply('SkySEO CRM. Нажми кнопку, чтобы открыть кабинет 👇', {
					reply_markup: {
						inline_keyboard: [[{ text: '📋 Открыть CRM', web_app: { url: webAppUrl } }]],
					},
				})
			})

			const timeout = new Promise((_, reject) =>
				setTimeout(() => reject(new Error('Connection timeout')), 10000),
			)
			const info: any = await Promise.race([this.bot.telegram.getMe(), timeout])
			this.botUsername = info.username || this.botUsername
			this.isEnabled = true
			console.log(`✅ CRM-bot connected: @${this.botUsername}`)

			if (isProd) {
				// Глобальная кнопка-меню (открывает Mini App у всех) — только прод.
				await this.bot.telegram
					.setChatMenuButton({
						menuButton: { type: 'web_app', text: 'CRM', web_app: { url: webAppUrl } },
					} as any)
					.catch(() => {})
				this.bot.launch().catch(err =>
					console.error('[CrmBot] Polling error:', err.message),
				)
				console.log('[CrmBot] polling started')
			} else {
				console.log('[CrmBot] dev: polling/menu button отключены, доступна только отправка')
			}
		} catch (e: any) {
			console.log('⚠️ CRM-bot connection failed:', e.message)
			this.bot = null
			this.isEnabled = false
		}
	}

	/** Отправка сообщения участнику CRM по его telegramId. Тихо игнорирует ошибки. */
	async sendToUser(
		telegramId: string | null | undefined,
		text: string,
		button?: { text: string; url: string },
	): Promise<boolean> {
		if (!this.isEnabled || !this.bot || !telegramId) return false
		try {
			// web_app-кнопку Telegram принимает только с https-URL — в деве (localhost/http)
			// кнопку не вешаем, само напоминание всё равно уходит.
			const btn =
				button && /^https:\/\//.test(button.url)
					? {
							reply_markup: {
								inline_keyboard: [[{ text: button.text, web_app: { url: button.url } }]],
							},
						}
					: {}
			await this.bot.telegram.sendMessage(telegramId, text, {
				parse_mode: 'HTML',
				link_preview_options: { is_disabled: true },
				...btn,
			} as any)
			return true
		} catch (e: any) {
			console.log('[CrmBot] sendToUser failed:', e?.message)
			return false
		}
	}

	onModuleDestroy() {
		try {
			this.bot?.stop('SIGTERM')
		} catch {}
	}
}
