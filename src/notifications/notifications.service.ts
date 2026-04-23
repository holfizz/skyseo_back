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

	async sendWelcomeAndVerificationEmail(
		email: string,
		verificationToken: string,
	) {
		const verifyUrl = `https://skyseo.site/verify-email?token=${verificationToken}`
		const subject = 'Добро пожаловать в SkySEO! Подтвердите email'
		const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #1400ff; text-align: center;">Добро пожаловать в SkySEO!</h2>
        
        <div style="background: linear-gradient(135deg, #1400ff 0%, #ffe381 100%); padding: 20px; border-radius: 12px; text-align: center; margin: 20px 0;">
          <h3 style="color: white; margin: 0 0 10px 0;">🎉 Приветственный бонус</h3>
          <p style="color: white; font-size: 18px; font-weight: bold; margin: 0;">Вам начислено 1000 баллов!</p>
        </div>

        <p>Спасибо за регистрацию в SkySEO! Теперь вы можете начать продвижение своих сайтов.</p>
        
        <div style="background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 8px; margin: 20px 0;">
          <h4 style="color: #856404; margin: 0 0 10px 0;">⚠️ Важно: Подтвердите email</h4>
          <p style="color: #856404; margin: 0;">Для пополнения баланса и полного доступа к функциям необходимо подтвердить ваш email адрес.</p>
        </div>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${verifyUrl}" style="background-color: #ffe381; color: #181818; padding: 15px 30px; text-decoration: none; border-radius: 12px; font-weight: bold; font-size: 16px; display: inline-block;">
            ✅ Подтвердить email
          </a>
        </div>

        <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin: 20px 0;">
          <h4 style="color: #495057; margin: 0 0 10px 0;">Что дальше?</h4>
          <ul style="color: #6c757d; margin: 0; padding-left: 20px;">
            <li>Добавьте свои сайты в панели управления</li>
            <li>Укажите ключевые слова для продвижения</li>
            <li>Запустите автоматическое продвижение</li>
            <li>Зарабатывайте баллы, выполняя задачи других пользователей</li>
          </ul>
        </div>

        <p style="color: #666; font-size: 14px; text-align: center;">
          Если письмо попало в спам, добавьте info@skyseo.site в список доверенных отправителей.
        </p>

        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
        <p style="text-align: center; color: #999; font-size: 14px;">
          С уважением,<br>
          <strong>Команда SkySEO</strong>
        </p>
      </div>
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
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #1400ff; text-align: center;">Подтвердите ваш email</h2>
        
        <p>Для завершения регистрации и получения полного доступа к функциям SkySEO подтвердите ваш email адрес:</p>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="${verifyUrl}" style="background-color: #ffe381; color: #181818; padding: 15px 30px; text-decoration: none; border-radius: 12px; font-weight: bold; font-size: 16px; display: inline-block;">
            ✅ Подтвердить email
          </a>
        </div>

        <div style="background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 8px; margin: 20px 0;">
          <p style="color: #856404; margin: 0;"><strong>Важно:</strong> Без подтверждения email вы не сможете пополнять баланс.</p>
        </div>

        <p style="color: #666; font-size: 14px; text-align: center;">
          Если письмо попало в спам, добавьте info@skyseo.site в список доверенных отправителей.
        </p>

        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
        <p style="text-align: center; color: #999; font-size: 14px;">
          С уважением,<br>
          <strong>Команда SkySEO</strong>
        </p>
      </div>
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
