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
		const frontendUrl = process.env.FRONTEND_URL || 'https://skyseo.site'
		const verifyUrl = `${frontendUrl}/verify-email?token=${verificationToken}`
		const subject = 'Добро пожаловать в SkySEO! Подтвердите email'
		const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #1400ff; text-align: center;">Добро пожаловать в SkySEO!</h2>
        
        <p>Спасибо за регистрацию в SkySEO! Теперь вы можете начать продвижение своих сайтов.</p>
        
        <!-- Cookie-style banner -->
        <div style="background: linear-gradient(135deg, #1400ff 0%, #3b82f6 100%); padding: 20px; border-radius: 12px; text-align: center; margin: 20px 0; border: 2px solid #1400ff;">
          <h3 style="color: white; margin: 0 0 10px 0; font-size: 18px;">Приветственный бонус</h3>
          <p style="color: white; font-size: 16px; font-weight: bold; margin: 0;">Вам начислено 1000 баллов!</p>
        </div>

        <div style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0;">
          <h4 style="color: #856404; margin: 0 0 10px 0;">Важно: Подтвердите email</h4>
          <p style="color: #856404; margin: 0;">Для пополнения баланса и полного доступа к функциям необходимо подтвердить ваш email адрес.</p>
        </div>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${verifyUrl}" style="background-color: #1400ff; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px; display: inline-block;">
            Подтвердить email
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
		const frontendUrl = process.env.FRONTEND_URL || 'https://skyseo.site'
		const verifyUrl = `${frontendUrl}/verify-email?token=${verificationToken}`
		const subject = 'Подтверждение email SkySEO'
		const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #1400ff; text-align: center;">Подтвердите ваш email</h2>
        
        <p>Для завершения регистрации и получения полного доступа к функциям SkySEO подтвердите ваш email адрес:</p>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="${verifyUrl}" style="background-color: #1400ff; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px; display: inline-block;">
            Подтвердить email
          </a>
        </div>

        <div style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0;">
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

	async sendWeeklyReport(email: string, data: {
		balance: number
		weeklyEarned: number
		tasksCompleted: number
		found: number
		websites: Array<{
			name: string
			url: string
			tasks: Array<{
				keyword: string | null
				positionHistory: Array<{ yandexPosition: number | null; googlePosition: number | null }>
			}>
		}>
	}) {
		const keywordsRows = data.websites.flatMap(site =>
			site.tasks.map(task => {
				const prev = task.positionHistory[1]
				const curr = task.positionHistory[0]
				const yDelta = prev?.yandexPosition && curr?.yandexPosition
					? prev.yandexPosition - curr.yandexPosition : null
				const gDelta = prev?.googlePosition && curr?.googlePosition
					? prev.googlePosition - curr.googlePosition : null
				const arrow = (d: number | null) => d === null ? '—' : d > 0 ? `↑${d}` : d < 0 ? `↓${Math.abs(d)}` : '='
				return `<tr>
					<td style="padding:8px;border-bottom:1px solid #eee;">${site.name}</td>
					<td style="padding:8px;border-bottom:1px solid #eee;">${task.keyword || '—'}</td>
					<td style="padding:8px;border-bottom:1px solid #eee;text-align:center;">${curr?.yandexPosition ?? '—'} <span style="color:${yDelta && yDelta > 0 ? 'green' : 'red'}">${arrow(yDelta)}</span></td>
					<td style="padding:8px;border-bottom:1px solid #eee;text-align:center;">${curr?.googlePosition ?? '—'} <span style="color:${gDelta && gDelta > 0 ? 'green' : 'red'}">${arrow(gDelta)}</span></td>
				</tr>`
			})
		).join('')

		const html = `
		<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
			<h2 style="color:#1400ff;">SkySEO — еженедельный отчёт</h2>

			<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin:20px 0;">
				<div style="background:#f0f4ff;border-radius:10px;padding:16px;text-align:center;">
					<div style="font-size:24px;font-weight:bold;color:#1400ff;">${data.balance}</div>
					<div style="color:#666;font-size:13px;">баланс баллов</div>
				</div>
				<div style="background:#f0fff4;border-radius:10px;padding:16px;text-align:center;">
					<div style="font-size:24px;font-weight:bold;color:#16a34a;">+${data.weeklyEarned}</div>
					<div style="color:#666;font-size:13px;">заработано за неделю</div>
				</div>
				<div style="background:#fff7ed;border-radius:10px;padding:16px;text-align:center;">
					<div style="font-size:24px;font-weight:bold;color:#ea580c;">${data.tasksCompleted}</div>
					<div style="color:#666;font-size:13px;">задач выполнено</div>
				</div>
			</div>

			${keywordsRows ? `
			<h3 style="color:#333;">Позиции по ключевым словам</h3>
			<table style="width:100%;border-collapse:collapse;font-size:14px;">
				<thead>
					<tr style="background:#f5f5f5;">
						<th style="padding:8px;text-align:left;">Сайт</th>
						<th style="padding:8px;text-align:left;">Запрос</th>
						<th style="padding:8px;text-align:center;">Яндекс</th>
						<th style="padding:8px;text-align:center;">Google</th>
					</tr>
				</thead>
				<tbody>${keywordsRows}</tbody>
			</table>` : '<p style="color:#666;">Нет активных ключевых слов.</p>'}

			<p style="color:#999;font-size:12px;margin-top:30px;">
				Вы получаете этот отчёт каждый понедельник. Отписаться можно в настройках профиля.
			</p>
			<hr style="border:none;border-top:1px solid #eee;">
			<p style="text-align:center;color:#999;font-size:13px;">Команда SkySEO</p>
		</div>`

		await this.sendEmail(email, 'SkySEO: еженедельный отчёт по позициям', html)
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
