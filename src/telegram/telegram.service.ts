import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Telegraf } from 'telegraf'

@Injectable()
export class TelegramService {
	private bot: Telegraf | null = null
	private adminId: string
	private isEnabled: boolean = false

	constructor(private configService: ConfigService) {
		this.adminId = this.configService.get('TELEGRAM_ADMIN_ID')
		const token = this.configService.get('TELEGRAM_BOT_TOKEN')

		// Пытаемся инициализировать бота только если есть валидный токен
		if (token && token !== 'dummy-token' && token.length >= 20) {
			this.initializeBot(token)
		} else {
			console.log('⚠️ Telegram notifications disabled (no valid token)')
		}
	}

	private async initializeBot(token: string) {
		try {
			// Настройка прокси для обхода блокировок в России
			const proxyUrl =
				this.configService.get('TELEGRAM_PROXY_URL') ||
				'socks5://127.0.0.1:1080'

			let botOptions: any = {}

			// Пытаемся использовать прокси если он настроен
			if (proxyUrl && proxyUrl !== 'disabled') {
				try {
					const { SocksProxyAgent } = require('socks-proxy-agent')
					const agent = new SocksProxyAgent(proxyUrl)
					botOptions = {
						telegram: {
							agent: agent,
							apiRoot: 'https://api.telegram.org',
						},
					}
					console.log(`🔄 Telegram: Using proxy ${proxyUrl}`)
				} catch (proxyError) {
					console.log(
						`⚠️ Telegram: Proxy failed (${proxyError.message}), trying direct connection`,
					)
					botOptions = {}
				}
			}

			this.bot = new Telegraf(token, botOptions)

			// Пытаемся проверить подключение с таймаутом
			const timeoutPromise = new Promise(
				(_, reject) =>
					setTimeout(() => reject(new Error('Connection timeout')), 10000), // Увеличиваем таймаут до 10 сек
			)

			const getMePromise = this.bot.telegram.getMe()

			const botInfo = await Promise.race([getMePromise, timeoutPromise])

			this.isEnabled = true
			console.log(
				`✅ Telegram bot connected successfully: @${(botInfo as any).username}`,
			)
		} catch (error) {
			console.log('⚠️ Telegram bot connection failed:', error.message)

			// Если прокси не сработал, пробуем без прокси
			if (error.message.includes('proxy') || error.message.includes('SOCKS')) {
				console.log('🔄 Telegram: Retrying without proxy...')
				try {
					this.bot = new Telegraf(token)
					const botInfo = await this.bot.telegram.getMe()
					this.isEnabled = true
					console.log(
						`✅ Telegram bot connected (direct): @${botInfo.username}`,
					)
					return
				} catch (directError) {
					console.log(
						'⚠️ Telegram: Direct connection also failed:',
						directError.message,
					)
				}
			}

			console.log('⚠️ Telegram notifications disabled')
			this.bot = null
			this.isEnabled = false
		}
	}

	async sendAdminNotification(message: string) {
		if (!this.isEnabled || !this.adminId || !this.bot) {
			console.log('[Telegram disabled]:', message)
			return
		}

		try {
			await this.bot.telegram.sendMessage(this.adminId, message, {
				parse_mode: 'HTML',
			})
		} catch (error) {
			console.error('Failed to send Telegram notification:', error.message)

			// Если ошибка связана с сетью, пытаемся переподключиться
			if (
				error.message.includes('ECONNRESET') ||
				error.message.includes('ENOTFOUND') ||
				error.message.includes('timeout')
			) {
				console.log('🔄 Telegram: Network error, attempting reconnect...')

				// Переинициализируем бота
				const token = this.configService.get('TELEGRAM_BOT_TOKEN')
				if (token) {
					setTimeout(() => {
						this.initializeBot(token)
					}, 5000) // Ждем 5 секунд перед переподключением
				}
			}
		}
	}

	async sendRegistrationNotification(
		email: string,
		city: string,
		source: string,
	) {
		const message =
			`🆕 <b>Новая регистрация</b>\n\n` +
			`📧 Email: ${email}\n` +
			`🌍 Город: ${city || 'Не указан'}\n` +
			`📍 Источник: ${source || 'Не указан'}`

		await this.sendAdminNotification(message)
	}

	async sendPaymentNotification(email: string, amount: number, points: number) {
		const message =
			`💰 <b>Новый платеж</b>\n\n` +
			`📧 Email: ${email}\n` +
			`💵 Сумма: ${amount} ₽\n` +
			`⭐ Баллы: ${points}`

		await this.sendAdminNotification(message)
	}

	async sendAppInstallNotification(email: string) {
		const message = `📱 <b>Установка приложения</b>\n\n` + `📧 Email: ${email}`

		await this.sendAdminNotification(message)
	}

	async sendComplaintNotification(
		text: string,
		contact?: string,
		userEmail?: string,
	) {
		const message =
			`⚠️ <b>Новая жалоба</b>\n\n` +
			`📝 Текст: ${text}\n` +
			`📧 Email пользователя: ${userEmail || 'Не авторизован'}\n` +
			`📞 Контакт для связи: ${contact || 'Не указан'}`

		await this.sendAdminNotification(message)
	}

	async sendContactFormNotification(data: {
		name: string
		email: string
		phone?: string
		message: string
	}) {
		const message =
			`📬 <b>Новая заявка с сайта</b>\n\n` +
			`👤 Имя: ${data.name}\n` +
			`📧 Email: ${data.email}\n` +
			`📞 Телефон: ${data.phone || 'Не указан'}\n` +
			`💬 Сообщение: ${data.message}`

		await this.sendAdminNotification(message)
	}
}
