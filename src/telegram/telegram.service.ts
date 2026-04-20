import { Injectable, Optional } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { InjectBot } from 'nestjs-telegraf'
import { Telegraf } from 'telegraf'

@Injectable()
export class TelegramService {
	private adminId: string
	private isEnabled: boolean

	constructor(
		@Optional() @InjectBot() private readonly bot: Telegraf,
		private configService: ConfigService,
	) {
		this.adminId = this.configService.get('TELEGRAM_ADMIN_ID')
		const token = this.configService.get('TELEGRAM_BOT_TOKEN')
		this.isEnabled = !!(token && token !== 'dummy-token' && this.bot)

		if (!this.isEnabled) {
			console.log('⚠️ Telegram bot disabled (no valid token)')
		} else {
			console.log('✅ Telegram bot enabled')
		}
	}

	async sendAdminNotification(message: string) {
		if (!this.isEnabled || !this.adminId) {
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
