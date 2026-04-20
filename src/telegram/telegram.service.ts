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
			this.bot = new Telegraf(token)

			// Пытаемся проверить подключение с таймаутом
			const timeoutPromise = new Promise((_, reject) =>
				setTimeout(() => reject(new Error('Connection timeout')), 5000),
			)

			const getMePromise = this.bot.telegram.getMe()

			await Promise.race([getMePromise, timeoutPromise])

			this.isEnabled = true
			console.log('✅ Telegram bot connected successfully')
		} catch (error) {
			console.log('⚠️ Telegram bot connection failed:', error.message)
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
