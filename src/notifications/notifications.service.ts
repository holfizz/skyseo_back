import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Transporter } from 'nodemailer'
import * as nodemailer from 'nodemailer'
import { Resend } from 'resend'

@Injectable()
export class NotificationsService {
	private resend: Resend | null = null
	private smtpTransporter: Transporter | null = null
	private useSmtp: boolean = false

	constructor(private configService: ConfigService) {
		// Проверяем какой метод отправки использовать
		const smtpHost = this.configService.get('SMTP_HOST')
		const resendApiKey = this.configService.get('RESEND_API_KEY')

		if (smtpHost) {
			// Используем SMTP (Beget или другой)
			this.useSmtp = true
			this.initializeSmtp()
		} else if (resendApiKey) {
			// Используем Resend
			this.useSmtp = false
			this.initializeResend(resendApiKey)
		} else {
			console.warn(
				'[NotificationsService] Neither SMTP nor RESEND_API_KEY configured, email sending will be disabled',
			)
		}
	}

	private initializeSmtp() {
		try {
			this.smtpTransporter = nodemailer.createTransport({
				host: this.configService.get('SMTP_HOST'),
				port: parseInt(this.configService.get('SMTP_PORT') || '465'),
				secure: this.configService.get('SMTP_SECURE') !== 'false', // true для 465, false для 587
				auth: {
					user: this.configService.get('SMTP_USER'),
					pass: this.configService.get('SMTP_PASS'),
				},
			})
			console.log('[NotificationsService] SMTP initialized successfully')
		} catch (error) {
			console.error('[NotificationsService] Failed to initialize SMTP:', error)
			this.smtpTransporter = null
		}
	}

	private initializeResend(apiKey: string) {
		try {
			this.resend = new Resend(apiKey)
			console.log('[NotificationsService] Resend initialized successfully')
		} catch (error) {
			console.error(
				'[NotificationsService] Failed to initialize Resend:',
				error,
			)
			this.resend = null
		}
	}

	async sendLowBalanceEmail(email: string, balance: number) {
		const subject = 'Низкий баланс на SkySEO'
		const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">
        <!-- Header -->
        <div style="background: #181818; padding: 40px 20px; text-align: center;">
          <h1 style="color: #ffffff; font-size: 24px; font-weight: 600; margin: 0; letter-spacing: 1px;">SkySEO</h1>
        </div>

        <!-- Main Content -->
        <div style="padding: 40px;">
          <h2 style="color: #181818; font-size: 24px; font-weight: 600; margin: 0 0 20px 0;">
            Внимание: низкий баланс
          </h2>
          
          <p style="color: #181818; font-size: 16px; line-height: 1.6; margin: 0 0 30px 0; text-align: center;">
            Пополните баланс для продолжения продвижения ваших сайтов
          </p>

          <!-- CTA Button -->
          <div style="text-align: center; margin: 0 0 40px 0;">
            <a href="https://skyseo.site/balance" style="display: inline-block; background: #007dff; color: #ffffff; padding: 18px 50px; text-decoration: none; font-weight: 600; font-size: 16px; letter-spacing: 1px; text-transform: uppercase; border-radius: 8px;">
              Пополнить баланс
            </a>
          </div>
          
          <div style="background: #ffd54e; padding: 40px; margin: 0 0 30px 0; text-align: center; border: 2px solid #181818;">
            <p style="color: #181818; margin: 0 0 10px 0; font-size: 12px; font-weight: 500; text-transform: uppercase; letter-spacing: 2px;">Текущий баланс</p>
            <p style="color: #181818; font-size: 56px; font-weight: 700; margin: 0;">${balance}</p>
            <p style="color: #181818; font-size: 14px; margin: 10px 0 0 0;">баллов</p>
          </div>

          <!-- Benefits -->
          <div style="border-left: 4px solid #181818; padding: 25px; margin: 0; background: #f5f5f5;">
            <h4 style="color: #181818; margin: 0 0 15px 0; font-size: 16px; font-weight: 600;">
              После пополнения вы сможете:
            </h4>
            <ul style="color: #181818; margin: 0; padding-left: 20px; line-height: 1.8; font-size: 14px;">
              <li>Продолжить автоматическое продвижение</li>
              <li>Создавать новые задачи для сайтов</li>
              <li>Зарабатывать баллы на выполнении задач</li>
              <li>Отслеживать рост позиций в поисковиках</li>
            </ul>
          </div>
        </div>

        <!-- Footer -->
        <div style="background: #181818; padding: 40px; text-align: center; color: #ffffff;">
          <p style="margin: 0 0 5px 0; font-size: 14px;">С уважением,</p>
          <p style="margin: 0; font-size: 16px; font-weight: 600;">Команда SkySEO</p>
        </div>
      </div>
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
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">
        <!-- Header -->
        <div style="background: #181818; padding: 40px 20px; text-align: center;">
          <h1 style="color: #ffffff; font-size: 24px; font-weight: 600; margin: 0; letter-spacing: 1px;">SkySEO</h1>
        </div>

        <!-- Main Content -->
        <div style="padding: 40px;">
          <h2 style="color: #181818; font-size: 24px; font-weight: 600; margin: 0 0 20px 0; text-align: center;">
            Добро пожаловать в SkySEO
          </h2>
          
          <p style="color: #181818; font-size: 16px; line-height: 1.6; margin: 0 0 30px 0; text-align: center;">
            Спасибо за регистрацию. Теперь вы можете начать продвижение своих сайтов
          </p>

          <!-- CTA Button -->
          <div style="text-align: center; margin: 0 0 40px 0;">
            <a href="${verifyUrl}" style="display: inline-block; background: #007dff; color: #ffffff; padding: 18px 50px; text-decoration: none; font-weight: 600; font-size: 16px; letter-spacing: 1px; text-transform: uppercase; border-radius: 8px;">
              Подтвердить email
            </a>
          </div>

          <!-- Bonus Card -->
          <div style="background: #ffd54e; padding: 40px; margin: 0 0 30px 0; text-align: center; border: 2px solid #181818;">
            <p style="color: #181818; margin: 0 0 10px 0; font-size: 12px; font-weight: 500; text-transform: uppercase; letter-spacing: 2px;">Приветственный бонус</p>
            <p style="color: #181818; font-size: 56px; font-weight: 700; margin: 0;">1000</p>
            <p style="color: #181818; font-size: 14px; margin: 10px 0 0 0;">баллов уже начислены на ваш счёт</p>
          </div>

          <!-- Verification Alert -->
          <div style="background: #f5f5f5; padding: 25px; margin: 0 0 30px 0; border-left: 4px solid #181818;">
            <h4 style="color: #181818; margin: 0 0 10px 0; font-size: 16px; font-weight: 600;">
              Важно: Подтвердите email
            </h4>
            <p style="color: #181818; margin: 0; font-size: 14px; line-height: 1.6;">
              Для пополнения баланса и полного доступа к функциям необходимо подтвердить ваш email адрес
            </p>
          </div>

          <!-- What's Next Section -->
          <div style="background: #f5f5f5; padding: 25px; margin: 0 0 20px 0; border: 2px solid #181818;">
            <h4 style="color: #181818; margin: 0 0 15px 0; font-size: 16px; font-weight: 600;">
              Что дальше?
            </h4>
            <ul style="color: #181818; margin: 0; padding-left: 20px; line-height: 1.8; font-size: 14px;">
              <li>Добавьте свои сайты в панели управления</li>
              <li>Укажите ключевые слова для продвижения</li>
              <li>Запустите автоматическое продвижение</li>
              <li>Зарабатывайте баллы, выполняя задачи других пользователей</li>
            </ul>
          </div>

          <!-- Spam Notice -->
          <p style="color: #666666; font-size: 12px; text-align: center; margin: 20px 0 0 0; line-height: 1.5;">
            Если письмо попало в спам, добавьте info@skyseo.site в список доверенных отправителей
          </p>
        </div>

        <!-- Footer -->
        <div style="background: #181818; padding: 40px; text-align: center; color: #ffffff;">
          <p style="margin: 0 0 5px 0; font-size: 14px;">С уважением,</p>
          <p style="margin: 0; font-size: 16px; font-weight: 600;">Команда SkySEO</p>
        </div>
      </div>
    `

		await this.sendEmail(email, subject, html)
	}

	async sendPaymentSuccessEmail(email: string, amount: number, points: number) {
		const subject = 'Платеж успешно выполнен'
		const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">
        <!-- Header -->
        <div style="background: #181818; padding: 40px 20px; text-align: center;">
          <h1 style="color: #ffffff; font-size: 24px; font-weight: 600; margin: 0; letter-spacing: 1px;">SkySEO</h1>
        </div>

        <!-- Main Content -->
        <div style="padding: 40px;">
          <h2 style="color: #181818; font-size: 24px; font-weight: 600; margin: 0 0 20px 0; text-align: center;">
            Платеж выполнен успешно
          </h2>

          <p style="color: #181818; font-size: 16px; line-height: 1.6; margin: 0 0 30px 0; text-align: center;">
            Спасибо за пополнение баланса. Теперь вы можете продолжить продвижение своих сайтов.
          </p>

          <!-- CTA Button -->
          <div style="text-align: center; margin: 0 0 40px 0;">
            <a href="https://skyseo.site/dashboard" style="display: inline-block; background: #007dff; color: #ffffff; padding: 18px 50px; text-decoration: none; font-weight: 600; font-size: 16px; letter-spacing: 1px; text-transform: uppercase; border-radius: 8px;">
              Перейти в панель управления
            </a>
          </div>

          <!-- Payment Details -->
          <div style="background: #f5f5f5; padding: 30px; margin: 0 0 20px 0; border: 2px solid #181818;">
            <div style="margin-bottom: 25px; text-align: center;">
              <p style="color: #181818; margin: 0 0 5px 0; font-size: 12px; text-transform: uppercase; letter-spacing: 2px;">Сумма платежа</p>
              <p style="color: #007dff; font-size: 36px; font-weight: 700; margin: 0;">${amount} ₽</p>
            </div>
            
            <div style="background: #ffd54e; padding: 30px; text-align: center; border: 2px solid #181818;">
              <p style="color: #181818; margin: 0 0 10px 0; font-size: 12px; text-transform: uppercase; letter-spacing: 2px;">Начислено баллов</p>
              <p style="color: #181818; font-size: 56px; font-weight: 700; margin: 0;">+${points}</p>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div style="background: #181818; padding: 40px; text-align: center; color: #ffffff;">
          <p style="margin: 0 0 5px 0; font-size: 14px;">С уважением,</p>
          <p style="margin: 0; font-size: 16px; font-weight: 600;">Команда SkySEO</p>
        </div>
      </div>
    `

		await this.sendEmail(email, subject, html)
	}

	async sendPasswordResetEmail(email: string, resetToken: string) {
		const resetUrl = `https://skyseo.site/reset-password?token=${resetToken}`
		const subject = 'Восстановление пароля SkySEO'
		const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">
        <!-- Header -->
        <div style="background: #181818; padding: 40px 20px; text-align: center;">
          <h1 style="color: #ffffff; font-size: 24px; font-weight: 600; margin: 0; letter-spacing: 1px;">SkySEO</h1>
        </div>

        <!-- Main Content -->
        <div style="padding: 60px 40px;">
          <h2 style="color: #181818; font-size: 24px; font-weight: 600; margin: 0 0 40px 0; text-align: center;">
            Восстановление пароля
          </h2>
          
          <p style="color: #181818; font-size: 16px; line-height: 1.6; margin: 0 0 40px 0; text-align: center;">
            Вы запросили восстановление пароля для вашего аккаунта SkySEO.
          </p>

          <div style="text-align: center; margin: 50px 0;">
            <a href="${resetUrl}" style="display: inline-block; background: #007dff; color: #ffffff; padding: 16px 40px; text-decoration: none; font-weight: 500; font-size: 14px; letter-spacing: 1px; text-transform: uppercase; border-radius: 8px;">
              Восстановить пароль
            </a>
          </div>

          <!-- Warning Box -->
          <div style="background: rgba(255, 226, 226, 0.3); padding: 20px; margin: 40px 0; border-left: 4px solid #181818;">
            <p style="color: #181818; margin: 0; font-size: 14px; line-height: 1.6;">
              Ссылка действительна в течение 1 часа.
            </p>
          </div>

          <p style="color: #666666; font-size: 14px; line-height: 1.6; margin: 40px 0 0 0; text-align: center;">
            Если вы не запрашивали восстановление пароля, просто проигнорируйте это письмо. Ваш пароль останется без изменений.
          </p>

          <!-- Security Notice -->
          <div style="background: #f5f5f5; padding: 20px; margin: 40px 0; border-left: 4px solid #181818;">
            <p style="color: #181818; margin: 0; font-size: 13px; line-height: 1.6;">
              <strong>Безопасность:</strong> Никогда не передавайте эту ссылку третьим лицам. Команда SkySEO никогда не попросит вас предоставить пароль.
            </p>
          </div>
        </div>

        <!-- Footer -->
        <div style="background: #181818; padding: 40px; text-align: center; color: #ffffff;">
          <p style="margin: 0 0 5px 0; font-size: 14px;">С уважением,</p>
          <p style="margin: 0; font-size: 16px; font-weight: 600;">Команда SkySEO</p>
        </div>
      </div>
    `

		await this.sendEmail(email, subject, html)
	}

	async sendEmailVerification(email: string, verificationToken: string) {
		const frontendUrl = process.env.FRONTEND_URL || 'https://skyseo.site'
		const verifyUrl = `${frontendUrl}/verify-email?token=${verificationToken}`
		const subject = 'Подтверждение email SkySEO'
		const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">
        <!-- Header -->
        <div style="background: #181818; padding: 40px 20px; text-align: center;">
          <h1 style="color: #ffffff; font-size: 24px; font-weight: 600; margin: 0; letter-spacing: 1px;">SkySEO</h1>
        </div>

        <!-- Main Content -->
        <div style="padding: 40px;">
          <h2 style="color: #181818; font-size: 24px; font-weight: 600; margin: 0 0 20px 0; text-align: center;">
            Подтвердите ваш email
          </h2>
          
          <p style="color: #181818; font-size: 16px; line-height: 1.6; margin: 0 0 30px 0; text-align: center;">
            Для завершения регистрации и получения полного доступа к функциям SkySEO подтвердите ваш email адрес.
          </p>

          <!-- CTA Button -->
          <div style="text-align: center; margin: 0 0 40px 0;">
            <a href="${verifyUrl}" style="display: inline-block; background: #007dff; color: #ffffff; padding: 18px 50px; text-decoration: none; font-weight: 600; font-size: 16px; letter-spacing: 1px; text-transform: uppercase; border-radius: 8px;">
              Подтвердить email
            </a>
          </div>

          <!-- Important Notice -->
          <div style="background: #f5f5f5; padding: 20px; margin: 0 0 20px 0; border-left: 4px solid #181818;">
            <p style="color: #181818; margin: 0; font-size: 14px; line-height: 1.6;">
              <strong>Важно:</strong> Без подтверждения email вы не сможете пополнять баланс и использовать все функции сервиса.
            </p>
          </div>

          <!-- Benefits Section -->
          <div style="background: #f5f5f5; padding: 25px; margin: 0 0 20px 0; border: 2px solid #181818;">
            <h4 style="color: #181818; margin: 0 0 15px 0; font-size: 16px; font-weight: 600;">
              После подтверждения вам будут доступны:
            </h4>
            <ul style="color: #181818; margin: 0; padding-left: 20px; line-height: 1.8; font-size: 14px;">
              <li>Пополнение баланса</li>
              <li>Создание задач для продвижения</li>
              <li>Заработок баллов</li>
              <li>Полный доступ к статистике</li>
            </ul>
          </div>

          <!-- Spam Notice -->
          <p style="color: #666666; font-size: 12px; text-align: center; margin: 20px 0 0 0;">
            Если письмо попало в спам, добавьте info@skyseo.site в список доверенных отправителей.
          </p>
        </div>

        <!-- Footer -->
        <div style="background: #181818; padding: 40px; text-align: center; color: #ffffff;">
          <p style="margin: 0 0 5px 0; font-size: 14px;">С уважением,</p>
          <p style="margin: 0; font-size: 16px; font-weight: 600;">Команда SkySEO</p>
        </div>
      </div>
    `

		await this.sendEmail(email, subject, html)
	}

	async sendWeeklyReport(
		email: string,
		data: {
			balance: number
			weeklyEarned: number
			tasksCompleted: number
			found: number
			websites: Array<{
				name: string
				url: string
				tasks: Array<{
					keyword: string | null
					positionHistory: Array<{
						yandexPosition: number | null
						googlePosition: number | null
					}>
				}>
			}>
		},
	) {
		const keywordsRows = data.websites
			.flatMap(site =>
				site.tasks.map(task => {
					const prev = task.positionHistory[1]
					const curr = task.positionHistory[0]
					const yDelta =
						prev?.yandexPosition && curr?.yandexPosition
							? prev.yandexPosition - curr.yandexPosition
							: null
					const gDelta =
						prev?.googlePosition && curr?.googlePosition
							? prev.googlePosition - curr.googlePosition
							: null
					const arrow = (d: number | null) =>
						d === null ? '—' : d > 0 ? `+${d}` : d < 0 ? `${d}` : '0'
					const arrowColor = (d: number | null) =>
						d === null
							? '#666666'
							: d > 0
								? '#007dff'
								: d < 0
									? '#181818'
									: '#666666'
					return `<tr>
					<td style="padding: 16px 12px; border-bottom: 2px solid #181818; color: #181818; font-size: 14px;">${site.name}</td>
					<td style="padding: 16px 12px; border-bottom: 2px solid #181818; color: #181818; font-size: 14px;">${task.keyword || '—'}</td>
					<td style="padding: 16px 12px; border-bottom: 2px solid #181818; text-align: center; color: #181818; font-size: 14px; font-weight: 600;">
						${curr?.yandexPosition ?? '—'} 
						<span style="color: ${arrowColor(yDelta)}; font-weight: 600; margin-left: 8px;">${arrow(yDelta)}</span>
					</td>
					<td style="padding: 16px 12px; border-bottom: 2px solid #181818; text-align: center; color: #181818; font-size: 14px; font-weight: 600;">
						${curr?.googlePosition ?? '—'} 
						<span style="color: ${arrowColor(gDelta)}; font-weight: 600; margin-left: 8px;">${arrow(gDelta)}</span>
					</td>
				</tr>`
				}),
			)
			.join('')

		const html = `
		<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 650px; margin: 0 auto; background: #ffffff;">
			<!-- Header -->
			<div style="background: #181818; padding: 40px 20px; text-align: center;">
				<h1 style="color: #ffffff; font-size: 24px; font-weight: 600; margin: 0 0 10px 0; letter-spacing: 1px;">SkySEO</h1>
				<p style="color: #ffffff; font-size: 14px; margin: 0; text-transform: uppercase; letter-spacing: 2px;">Еженедельный отчёт</p>
			</div>

			<!-- Main Content -->
			<div style="padding: 60px 40px;">
				<!-- Stats Cards -->
				<div style="margin: 0 0 40px 0;">
					<div style="background: #fbe395; padding: 30px; margin-bottom: 20px; border: 2px solid #181818;">
						<p style="color: #181818; margin: 0 0 5px 0; font-size: 12px; text-transform: uppercase; letter-spacing: 2px;">Баланс баллов</p>
						<p style="color: #181818; font-size: 36px; font-weight: 600; margin: 0;">${data.balance}</p>
					</div>
					<div style="background: #dbdfff; padding: 30px; margin-bottom: 20px; border: 2px solid #181818;">
						<p style="color: #181818; margin: 0 0 5px 0; font-size: 12px; text-transform: uppercase; letter-spacing: 2px;">Заработано за неделю</p>
						<p style="color: #181818; font-size: 36px; font-weight: 600; margin: 0;">+${data.weeklyEarned}</p>
					</div>
					<div style="background: #ffe2e2; padding: 30px; border: 2px solid #181818;">
						<p style="color: #181818; margin: 0 0 5px 0; font-size: 12px; text-transform: uppercase; letter-spacing: 2px;">Задач выполнено</p>
						<p style="color: #181818; font-size: 36px; font-weight: 600; margin: 0;">${data.tasksCompleted}</p>
					</div>
				</div>

				${
					keywordsRows
						? `
				<!-- Positions Table -->
				<div style="margin: 40px 0;">
					<h3 style="color: #181818; margin: 0 0 20px 0; font-size: 18px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px;">
						Позиции по ключевым словам
					</h3>
					<div style="background: #ffffff; border: 2px solid #181818; overflow: hidden;">
						<table style="width: 100%; border-collapse: collapse; font-size: 14px;">
							<thead>
								<tr style="background: #181818;">
									<th style="padding: 16px 12px; text-align: left; color: #ffffff; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">Сайт</th>
									<th style="padding: 16px 12px; text-align: left; color: #ffffff; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">Запрос</th>
									<th style="padding: 16px 12px; text-align: center; color: #ffffff; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">Яндекс</th>
									<th style="padding: 16px 12px; text-align: center; color: #ffffff; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">Google</th>
								</tr>
							</thead>
							<tbody>${keywordsRows}</tbody>
						</table>
					</div>
				</div>`
						: `
				<div style="background: #dbdfff; padding: 40px; margin: 40px 0; text-align: center; border: 2px solid #181818;">
					<p style="color: #181818; margin: 0; font-size: 14px;">Нет активных ключевых слов для отслеживания.</p>
				</div>`
				}

				<!-- CTA Button -->
				<div style="text-align: center; margin: 50px 0;">
					<a href="https://skyseo.site/dashboard" style="display: inline-block; background: #007dff; color: #ffffff; padding: 16px 40px; text-decoration: none; font-weight: 500; font-size: 14px; letter-spacing: 1px; text-transform: uppercase; border: 2px solid #181818;">
						Открыть панель управления
					</a>
				</div>

				<!-- Unsubscribe Notice -->
				<p style="color: #666666; font-size: 12px; text-align: center; margin: 30px 0 0 0;">
					Вы получаете этот отчёт каждый понедельник. Отписаться можно в настройках профиля.
				</p>
			</div>

			<!-- Footer -->
			<div style="background: #181818; padding: 40px; text-align: center; color: #ffffff;">
				<p style="margin: 0 0 5px 0; font-size: 14px;">С уважением,</p>
				<p style="margin: 0; font-size: 16px; font-weight: 600;">Команда SkySEO</p>
			</div>
		</div>`

		await this.sendEmail(email, 'SkySEO: еженедельный отчёт по позициям', html)
	}

	private async sendEmail(to: string, subject: string, html: string) {
		try {
			if (this.useSmtp && this.smtpTransporter) {
				// Отправка через SMTP (Beget)
				const emailFrom =
					this.configService.get('SMTP_FROM') || 'SkySEO <info@skyseo.site>'

				const info = await this.smtpTransporter.sendMail({
					from: emailFrom,
					to,
					subject,
					html,
				})

				console.log(
					`[NotificationsService] Email sent via SMTP successfully, ID: ${info.messageId}`,
				)
			} else if (!this.useSmtp && this.resend) {
				// Отправка через Resend
				const emailDomain = to.split('@')[1]?.toLowerCase()
				console.log(
					`[NotificationsService] Sending email to domain: ${emailDomain}`,
				)

				const { data, error } = await this.resend.emails.send({
					from:
						this.configService.get('EMAIL_FROM') ||
						'SkySEO <onboarding@resend.dev>',
					to,
					subject,
					html,
				})

				if (error) {
					console.error('[NotificationsService] Failed to send email:', error)
					throw error
				}

				console.log(
					`[NotificationsService] Email sent via Resend successfully, ID: ${data?.id}`,
				)
			} else {
				console.warn(
					'[NotificationsService] No email service configured, skipping email send',
				)
				return
			}
		} catch (error) {
			console.error('[NotificationsService] Failed to send email:', error)
			throw error
		}
	}
}
