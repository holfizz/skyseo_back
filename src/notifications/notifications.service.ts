import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as nodemailer from 'nodemailer'

@Injectable()
export class NotificationsService {
	private transporter: nodemailer.Transporter

	constructor(private configService: ConfigService) {
		this.transporter = nodemailer.createTransport({
			host: this.configService.get('SMTP_HOST'),
			port: this.configService.get('SMTP_PORT'),
			secure: false,
			auth: {
				user: this.configService.get('SMTP_USER'),
				pass: this.configService.get('SMTP_PASSWORD'),
			},
		})
	}

	async sendLowBalanceEmail(email: string, balance: number) {
		const subject = '⚠️ Низкий баланс на SkySEO'
		const html = `
      <h2>Внимание! Низкий баланс</h2>
      <p>Ваш текущий баланс: <strong>${balance} баллов</strong></p>
      <p>Пожалуйста, пополните баланс для продолжения работы.</p>
      <p>Вы можете пополнить баланс в личном кабинете.</p>
      <br>
      <p>С уважением,<br>Команда SkySEO</p>
    `

		await this.sendEmail(email, subject, html)
	}

	async sendWelcomeEmail(email: string) {
		const subject = '🎉 Добро пожаловать в SkySEO!'
		const html = `
      <h2>Добро пожаловать!</h2>
      <p>Спасибо за регистрацию в SkySEO.</p>
      <p>Вам начислено <strong>5000 баллов</strong> в качестве приветственного бонуса!</p>
      <p>Начните добавлять свои сайты и ключевые слова для продвижения.</p>
      <br>
      <p>С уважением,<br>Команда SkySEO</p>
    `

		await this.sendEmail(email, subject, html)
	}

	async sendPaymentSuccessEmail(email: string, amount: number, points: number) {
		const subject = '✅ Платеж успешно выполнен'
		const html = `
      <h2>Платеж выполнен успешно!</h2>
      <p>Сумма: <strong>${amount} ₽</strong></p>
      <p>Начислено баллов: <strong>${points}</strong></p>
      <p>Спасибо за пополнение баланса!</p>
      <br>
      <p>С уважением,<br>Команда SkySEO</p>
    `

		await this.sendEmail(email, subject, html)
	}

	private async sendEmail(to: string, subject: string, html: string) {
		try {
			await this.transporter.sendMail({
				from: this.configService.get('EMAIL_FROM'),
				to,
				subject,
				html,
			})
		} catch (error) {
			console.error('Failed to send email:', error)
		}
	}
}
