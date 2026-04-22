import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Resend } from 'resend'

@Injectable()
export class NotificationsService {
	private resend: Resend

	constructor(private configService: ConfigService) {
		const apiKey = this.configService.get('RESEND_API_KEY')
		if (!apiKey) {
			console.warn(
				'[NotificationsService] RESEND_API_KEY not found, email sending will be disabled',
			)
			this.resend = null as any
		} else {
			try {
				this.resend = new Resend(apiKey)
				console.log('[NotificationsService] Resend initialized successfully')
			} catch (error) {
				console.error(
					'[NotificationsService] Failed to initialize Resend:',
					error,
				)
				this.resend = null as any
			}
		}
	}

	async sendLowBalanceEmail(email: string, balance: number) {
		const subject = 'Низкий баланс на SkySEO'
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
		const subject = 'Добро пожаловать в SkySEO!'
		const html = `
      <h2>Добро пожаловать!</h2>
      <p>Спасибо за регистрацию в SkySEO.</p>
      <p>Вам начислено <strong>1000 баллов</strong> в качестве приветственного бонуса!</p>
      <p><strong>Важно:</strong> Для пополнения баланса необходимо подтвердить email адрес. Письмо с подтверждением отправлено отдельно.</p>
      <p>Если письмо не пришло, проверьте папку "Спам".</p>
      <p>Начните добавлять свои сайты и ключевые слова для продвижения.</p>
      <br>
      <p>С уважением,<br>Команда SkySEO</p>
    `

		await this.sendEmail(email, subject, html)
	}

	async sendPaymentSuccessEmail(email: string, amount: number, points: number) {
		const subject = 'Платеж успешно выполнен'
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

	async sendPasswordResetEmail(email: string, resetToken: string) {
		const resetUrl = `https://skyseo.site/reset-password?token=${resetToken}`
		const subject = 'Восстановление пароля SkySEO'
		const html = `
      <h2>Восстановление пароля</h2>
      <p>Вы запросили восстановление пароля для вашего аккаунта SkySEO.</p>
      <p>Для сброса пароля перейдите по ссылке:</p>
      <p><a href="${resetUrl}" style="background-color: #1400ff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Восстановить пароль</a></p>
      <p>Ссылка действительна в течение 1 часа.</p>
      <p>Если вы не запрашивали восстановление пароля, просто проигнорируйте это письмо.</p>
      <br>
      <p>С уважением,<br>Команда SkySEO</p>
    `

		await this.sendEmail(email, subject, html)
	}

	async sendEmailVerification(email: string, verificationToken: string) {
		const verifyUrl = `https://skyseo.site/verify-email?token=${verificationToken}`
		const subject = 'Подтверждение email SkySEO'
		const html = `
      <h2>Подтвердите ваш email</h2>
      <p>Спасибо за регистрацию в SkySEO!</p>
      <p>Для завершения регистрации подтвердите ваш email адрес:</p>
      <p><a href="${verifyUrl}" style="background-color: #ffe381; color: #181818; padding: 12px 24px; text-decoration: none; border-radius: 12px; font-weight: bold;">Подтвердить email</a></p>
      <p><strong>Важно:</strong> Без подтверждения email вы не сможете пополнять баланс.</p>
      <p style="color: #666; font-size: 14px;">Если письмо не пришло, проверьте папку "Спам".</p>
      <br>
      <p>С уважением,<br>Команда SkySEO</p>
    `

		await this.sendEmail(email, subject, html)
	}

	private async sendEmail(to: string, subject: string, html: string) {
		try {
			if (!this.resend) {
				console.warn(
					'[NotificationsService] Resend not initialized, skipping email send',
				)
				return
			}

			const emailDomain = to.split('@')[1]?.toLowerCase()
			console.log(
				`[NotificationsService] Sending email to domain: ${emailDomain}`,
			)

			const { data, error } = await this.resend.emails.send({
				from:
					this.configService.get('EMAIL_FROM') || 'SkySEO <info@skyseo.site>',
				to,
				subject,
				html,
			})

			if (error) {
				console.error('[NotificationsService] Failed to send email:', error)
				throw error
			}

			console.log(
				`[NotificationsService] Email sent successfully, ID: ${data?.id}`,
			)
		} catch (error) {
			console.error('[NotificationsService] Failed to send email:', error)
			throw error
		}
	}
}
