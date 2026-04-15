import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as TelegramBot from 'node-telegram-bot-api'

@Injectable()
export class TelegramService {
	private bot: TelegramBot
	private adminId: string

	constructor(private configService: ConfigService) {
		const token = this.configService.get('TELEGRAM_BOT_TOKEN')
		this.adminId = this.configService.get('TELEGRAM_ADMIN_ID')

		if (token) {
			this.bot = new TelegramBot(token, { polling: false })
		}
	}

	async sendAdminNotification(message: string) {
		if (!this.bot || !this.adminId) {
			console.log('Telegram not configured:', message)
			return
		}

		try {
			await this.bot.sendMessage(this.adminId, message, {
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
}
