import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { InjectBot } from 'nestjs-telegraf'
import { Telegraf } from 'telegraf'

@Injectable()
export class TelegramService {
	private adminId: string

	constructor(
		@InjectBot() private readonly bot: Telegraf,
		private configService: ConfigService,
	) {
		this.adminId = this.configService.get('TELEGRAM_ADMIN_ID')
	}

	async sendAdminNotification(message: string) {
		if (!this.bot || !this.adminId) {
			console.log('Telegram not configured:', message)
			return
		}

		try {
			await this.bot.telegram.sendMessage(this.adminId, message, {
				parse_mode: 'HTML',
			})
		} catch (error) {
			console.error('Failed to send Telegram notification:', error)
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
