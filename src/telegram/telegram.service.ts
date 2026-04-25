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
		console.log('[TelegramService] Initializing bot...')
		try {
			// Инициализируем бота без прокси
			this.bot = new Telegraf(token)

			// Пытаемся проверить подключение с таймаутом
			const timeoutPromise = new Promise((_, reject) =>
				setTimeout(() => reject(new Error('Connection timeout')), 10000),
			)

			console.log('[TelegramService] Testing bot connection...')
			const getMePromise = this.bot.telegram.getMe()

			const botInfo = await Promise.race([getMePromise, timeoutPromise])

			this.isEnabled = true
			console.log(
				`✅ Telegram bot connected successfully: @${(botInfo as any).username}`,
			)

			// Отправляем тестовое сообщение при инициализации (только в dev режиме)
			if (
				this.configService.get('NODE_ENV') === 'development' &&
				this.adminId
			) {
				try {
					await this.bot.telegram.sendMessage(
						this.adminId,
						'🤖 Telegram bot initialized successfully!',
					)
					console.log('✅ Test message sent to admin')
				} catch (testError) {
					console.error('❌ Failed to send test message:', testError.message)
				}
			}
		} catch (error) {
			console.log('⚠️ Telegram bot connection failed:', error.message)
			console.log('⚠️ Telegram notifications disabled')
			this.bot = null
			this.isEnabled = false
		}
	}

	async sendAdminNotification(message: string) {
		console.log('[TelegramService] Attempting to send notification...')
		console.log('[TelegramService] Bot enabled:', this.isEnabled)
		console.log('[TelegramService] Admin ID:', this.adminId ? 'set' : 'not set')
		console.log('[TelegramService] Bot instance:', this.bot ? 'exists' : 'null')

		if (!this.isEnabled || !this.adminId || !this.bot) {
			console.log('[Telegram disabled]:', message)
			return
		}

		try {
			console.log(
				'[TelegramService] Sending message to admin ID:',
				this.adminId,
			)
			await this.bot.telegram.sendMessage(this.adminId, message, {
				parse_mode: 'HTML',
			})
			console.log('[TelegramService] Message sent successfully')
		} catch (error) {
			console.error(
				'[TelegramService] Failed to send notification:',
				error.message,
			)
			console.error('[TelegramService] Full error:', error)

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
