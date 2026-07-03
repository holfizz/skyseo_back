import { randomUUID } from 'crypto'
import * as https from 'https'
import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { AlertsService } from '../alerts/alerts.service'
import { NotificationsService } from '../notifications/notifications.service'
import { PrismaService } from '../prisma/prisma.service'
import { TelegramService } from '../telegram/telegram.service'
import { UsersService } from '../users/users.service'
import { CreatePaymentDto } from './dto'

@Injectable()
export class PaymentsService implements OnModuleInit {
	private shopId: string
	private secretKey: string

	constructor(
		private prisma: PrismaService,
		private usersService: UsersService,
		private telegramService: TelegramService,
		private notificationsService: NotificationsService,
		private configService: ConfigService,
		private alerts: AlertsService,
	) {
		this.shopId = this.configService.get('YOOKASSA_SHOP_ID')
		this.secretKey = this.configService.get('YOOKASSA_SECRET_KEY')
	}

	onModuleInit() {
		// Дожим брошенных платежей: раз в 15 минут ищем неоплаченные заявки и шлём скидку 10%.
		setInterval(() => {
			this.processAbandonedPayments().catch(err =>
				console.error('[Payments] abandoned offers error:', err?.message),
			)
		}, 15 * 60 * 1000)
	}

	private get frontendUrl(): string {
		return this.configService.get('FRONTEND_URL') || 'https://skyseo.site'
	}

	async createPayment(userId: string, dto: CreatePaymentDto) {
		console.log('[Payments] Creating payment', {
			userId: userId.substring(0, 8) + '...',
			points: dto.points,
			amount: dto.amount,
		})

		const user = await this.usersService.findById(userId)

		// Проверяем подтверждение email
		if (!user.emailVerified) {
			throw new BadRequestException(
				'Необходимо подтвердить email перед пополнением баланса',
			)
		}

		// Создаем платеж в БД
		const payment = await this.prisma.payment.create({
			data: {
				userId,
				amount: dto.amount,
				points: dto.points,
				status: 'PENDING',
			},
		})

		console.log('[Payments] Payment created in DB', {
			paymentId: payment.id,
			status: payment.status,
		})

		// Создаем платеж в YooKassa
		const yooKassaPayment = await this.createYooKassaPayment(
			payment.id,
			dto.amount,
			user.email,
		)

		console.log('[Payments] YooKassa payment created', {
			paymentId: payment.id,
			externalId: yooKassaPayment.id,
			hasConfirmationUrl: !!yooKassaPayment.confirmation?.confirmation_url,
		})

		// Обновляем платеж с данными YooKassa
		const updatedPayment = await this.prisma.payment.update({
			where: { id: payment.id },
			data: {
				externalId: yooKassaPayment.id,
				confirmationUrl: yooKassaPayment.confirmation?.confirmation_url,
			},
		})

		return updatedPayment
	}

	async handleYooKassaWebhook(body: any) {
		console.log(
			'[Payments] Webhook received - FULL BODY:',
			JSON.stringify(body, null, 2),
		)

		const { event, object } = body

		console.log('[Payments] Webhook parsed', {
			event,
			paymentId: object?.id,
			status: object?.status,
			amount: object?.amount?.value,
			currency: object?.amount?.currency,
			paid: object?.paid,
			test: object?.test,
		})

		if (event === 'payment.succeeded') {
			const externalId = object.id
			console.log(
				'[Payments] Processing payment.succeeded for externalId:',
				externalId,
			)

			const payment = await this.prisma.payment.findUnique({
				where: { externalId },
				include: { user: { select: { id: true, email: true, balance: true, referredBy: true } } },
			})

			if (!payment) {
				console.error('[Payments] Payment not found in database', {
					externalId,
				})
				return { success: false, error: 'Payment not found' }
			}

			console.log('[Payments] Payment found in database', {
				paymentId: payment.id,
				currentStatus: payment.status,
				userId: payment.userId.substring(0, 8) + '...',
				points: payment.points,
				amount: payment.amount,
			})

			if (payment.status === 'SUCCEEDED') {
				console.log('[Payments] Payment already processed', {
					paymentId: payment.id,
				})
				return { success: true, message: 'Already processed' }
			}

			console.log('[Payments] Processing payment', {
				paymentId: payment.id,
				userId: payment.userId.substring(0, 8) + '...',
				points: payment.points,
			})

			// Обновляем статус платежа
			await this.prisma.payment.update({
				where: { id: payment.id },
				data: {
					status: 'SUCCEEDED',
					paidAt: new Date(),
				},
			})

			console.log('[Payments] Payment status updated to SUCCEEDED')

			// Начисляем баллы
			await this.usersService.updateBalance(
				payment.userId,
				payment.points,
				'PAYMENT',
				`Пополнение баланса на ${payment.amount} ₽`,
			)

			// Реферальный бонус — +10% пригласившему
			await this.grantReferralBonus(payment.user.referredBy, payment.points)

			// Уведомление пользователю (Telegram-бот уведомлений)
			this.alerts
				.paymentSucceeded(payment.userId, Number(payment.amount), payment.points)
				.catch(() => {})

			console.log('[Payments] Balance updated', {
				paymentId: payment.id,
				pointsAdded: payment.points,
			})

			// Отправляем уведомления
			console.log('[Payments] Sending Telegram notification...')
			try {
				await this.telegramService.sendPaymentNotification(
					payment.user.email,
					Number(payment.amount),
					payment.points,
				)
				console.log('[Payments] ✅ Telegram notification sent successfully')
			} catch (error) {
				console.error(
					'[Payments] ❌ Failed to send Telegram notification:',
					error,
				)
				console.error('[Payments] Error details:', {
					message: error.message,
					stack: error.stack,
				})
			}

			console.log('[Payments] Sending email notification...')
			try {
				await this.notificationsService.sendPaymentSuccessEmail(
					payment.user.email,
					Number(payment.amount),
					payment.points,
				)
				console.log('[Payments] ✅ Email notification sent successfully')
			} catch (error) {
				console.error('[Payments] ❌ Failed to send email notification:', error)
			}

			console.log('[Payments] Payment processing completed successfully', {
				paymentId: payment.id,
			})
		} else {
			console.log('[Payments] Webhook event not handled:', event)
		}

		return { success: true }
	}

	async getPaymentHistory(userId: string) {
		return this.prisma.payment.findMany({
			where: { userId },
			orderBy: { createdAt: 'desc' },
		})
	}

	// Скидка 10% на «те же баллы»
	private discountedAmount(amount: number): number {
		return Math.max(100, Math.round(amount * 0.9))
	}

	// Находит брошенные (неоплаченные) заявки и один раз шлёт скидочное предложение.
	async processAbandonedPayments() {
		const now = Date.now()
		const abandoned = await this.prisma.payment.findMany({
			where: {
				status: 'PENDING',
				offerSentAt: null,
				confirmationUrl: { not: null },
				// прошло хотя бы 30 минут, но не старше суток
				createdAt: {
					gte: new Date(now - 24 * 60 * 60 * 1000),
					lte: new Date(now - 30 * 60 * 1000),
				},
			},
			orderBy: { createdAt: 'desc' },
			take: 50,
		})

		for (const p of abandoned) {
			// Не слать, если пользователь уже что-то оплатил (успешный платёж существует)
			const paidCount = await this.prisma.payment.count({
				where: { userId: p.userId, status: 'SUCCEEDED' },
			})
			if (paidCount > 0) {
				await this.prisma.payment.update({
					where: { id: p.id },
					data: { offerSentAt: new Date() }, // помечаем, чтобы не проверять снова
				})
				continue
			}

			const token = randomUUID()
			const amount = this.discountedAmount(Number(p.amount))
			await this.prisma.payment.update({
				where: { id: p.id },
				data: { offerSentAt: new Date(), discountToken: token },
			})
			this.alerts
				.abandonedPaymentOffer(p.userId, {
					points: p.points,
					amount,
					url: `${this.frontendUrl}/payment/repeat?token=${token}`,
				})
				.catch(() => {})
		}

		return { offered: abandoned.length }
	}

	// Создаёт новый платёж со скидкой 10% по одноразовому токену и возвращает ссылку на оплату.
	async createDiscountedRepeat(token: string): Promise<{ confirmationUrl: string }> {
		const original = await this.prisma.payment.findUnique({
			where: { discountToken: token },
			include: { user: { select: { id: true, email: true } } },
		})
		if (!original) {
			throw new BadRequestException('Ссылка недействительна')
		}
		if (original.status === 'SUCCEEDED') {
			throw new BadRequestException('Этот платёж уже оплачен')
		}

		const amount = this.discountedAmount(Number(original.amount))
		const payment = await this.prisma.payment.create({
			data: {
				userId: original.userId,
				amount,
				points: original.points, // те же баллы
				status: 'PENDING',
			},
		})
		const yk = await this.createYooKassaPayment(
			payment.id,
			amount,
			original.user.email,
		)
		const updated = await this.prisma.payment.update({
			where: { id: payment.id },
			data: {
				externalId: yk.id,
				confirmationUrl: yk.confirmation?.confirmation_url,
			},
		})
		if (!updated.confirmationUrl) {
			throw new BadRequestException('Не удалось создать платёж, попробуйте позже')
		}
		return { confirmationUrl: updated.confirmationUrl }
	}

	async getPaymentStatus(paymentId: string, userId: string) {
		console.log('[Payments] Getting payment status', {
			paymentId,
			userId: userId.substring(0, 8) + '...',
		})

		const payment = await this.prisma.payment.findUnique({
			where: { id: paymentId },
			include: { user: true },
		})

		if (!payment || payment.userId !== userId) {
			console.error('[Payments] Payment not found or access denied', {
				paymentId,
				userId: userId.substring(0, 8) + '...',
			})
			throw new Error('Payment not found')
		}

		console.log('[Payments] Payment found in database', {
			paymentId: payment.id,
			status: payment.status,
			externalId: payment.externalId,
		})

		// Если платеж еще не завершен, проверяем статус в YooKassa
		if (payment.status === 'PENDING' && payment.externalId) {
			try {
				console.log('[Payments] Checking status in YooKassa', {
					externalId: payment.externalId,
				})

				const yooKassaStatus = await this.checkYooKassaPaymentStatus(
					payment.externalId,
				)

				console.log('[Payments] YooKassa status received', {
					externalId: payment.externalId,
					status: yooKassaStatus.status,
					paid: yooKassaStatus.paid,
				})

				// Если статус изменился, обновляем в базе
				if (yooKassaStatus.status === 'succeeded') {
					console.log(
						'[Payments] Payment succeeded via polling, updating status',
					)

					await this.prisma.payment.update({
						where: { id: payment.id },
						data: {
							status: 'SUCCEEDED',
							paidAt: new Date(),
						},
					})

					// Начисляем баллы
					await this.usersService.updateBalance(
						payment.userId,
						payment.points,
						'PAYMENT',
						`Пополнение баланса на ${payment.amount} ₽`,
					)

					// Реферальный бонус — +10% пригласившему (тот же путь, что и в webhook)
					await this.grantReferralBonus(payment.user.referredBy, payment.points)

					// Уведомление пользователю (Telegram-бот уведомлений)
					this.alerts
						.paymentSucceeded(payment.userId, Number(payment.amount), payment.points)
						.catch(() => {})

					console.log('[Payments] Balance updated for payment', {
						paymentId: payment.id,
					})

					// Отправляем уведомления (важно!)
					console.log(
						'[Payments] Sending Telegram notification (from polling)...',
					)
					try {
						await this.telegramService.sendPaymentNotification(
							payment.user.email,
							Number(payment.amount),
							payment.points,
						)
						console.log('[Payments] ✅ Telegram notification sent successfully')
					} catch (error) {
						console.error(
							'[Payments] ❌ Failed to send Telegram notification:',
							error,
						)
						console.error('[Payments] Error details:', {
							message: error.message,
							stack: error.stack,
						})
					}

					console.log('[Payments] Sending email notification (from polling)...')
					try {
						await this.notificationsService.sendPaymentSuccessEmail(
							payment.user.email,
							Number(payment.amount),
							payment.points,
						)
						console.log('[Payments] ✅ Email notification sent successfully')
					} catch (error) {
						console.error(
							'[Payments] ❌ Failed to send email notification:',
							error,
						)
					}

					return { ...payment, status: 'SUCCEEDED' }
				}

				// Терминальная отмена/истёкший срок: фиксируем в БД, иначе статус навсегда
				// остаётся PENDING и фронт опрашивает YooKassa бесконечно (каждые 3с).
				if (yooKassaStatus.status === 'canceled') {
					console.log('[Payments] Payment canceled in YooKassa, updating status')
					await this.prisma.payment.update({
						where: { id: payment.id },
						data: { status: 'CANCELED' },
					})
					return { ...payment, status: 'CANCELED' }
				}
			} catch (error) {
				console.error('[Payments] Failed to check YooKassa status:', error)
			}
		}

		return payment
	}

	// +10% баллов пригласившему с каждого пополнения друга.
	// Вызывается из обоих путей подтверждения платежа (webhook и polling) —
	// они взаимоисключающие по статусу, поэтому бонус начислится ровно один раз.
	private async grantReferralBonus(referredBy: string | null | undefined, points: number) {
		if (!referredBy) return
		const referralBonus = Math.floor(points * 0.1)
		if (referralBonus <= 0) return
		await this.usersService.updateBalance(
			referredBy,
			referralBonus,
			'REFERRAL_BONUS',
			`Реферальный бонус 10% от пополнения друга (${points} баллов)`,
		)
		console.log(`[Payments] Реферальный бонус ${referralBonus} баллов → ${referredBy}`)
	}

	// Node.js 24 built-in fetch (undici) fails on some environments — use https module directly
	private httpsPost(path: string, body: object, headers: Record<string, string>): Promise<{ status: number; data: any }> {
		return new Promise((resolve, reject) => {
			const bodyStr = JSON.stringify(body)
			const req = https.request(
				{
					hostname: 'api.yookassa.ru', path, method: 'POST',
					headers: { ...headers, 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(bodyStr)) },
					timeout: 15000,
				},
				res => {
					let raw = ''
					res.on('data', c => raw += c)
					res.on('end', () => { try { resolve({ status: res.statusCode!, data: JSON.parse(raw) }) } catch { reject(new Error('Invalid JSON: ' + raw.slice(0, 200))) } })
				},
			)
			req.on('timeout', () => { req.destroy(); reject(new Error('YooKassa request timeout')) })
			req.on('error', reject)
			req.write(bodyStr)
			req.end()
		})
	}

	private httpsGet(path: string, headers: Record<string, string>): Promise<{ status: number; data: any }> {
		return new Promise((resolve, reject) => {
			const req = https.request(
				{
					hostname: 'api.yookassa.ru', path, method: 'GET',
					headers: { ...headers, 'Content-Type': 'application/json' },
					timeout: 15000,
				},
				res => {
					let raw = ''
					res.on('data', c => raw += c)
					res.on('end', () => { try { resolve({ status: res.statusCode!, data: JSON.parse(raw) }) } catch { reject(new Error('Invalid JSON')) } })
				},
			)
			req.on('timeout', () => { req.destroy(); reject(new Error('YooKassa request timeout')) })
			req.on('error', reject)
			req.end()
		})
	}

	private async createYooKassaPayment(
		paymentId: string,
		amount: number,
		email: string,
	) {
		console.log('[Payments] Creating YooKassa payment', {
			paymentId,
			amount,
			emailDomain: email.split('@')[1],
		})

		const auth = Buffer.from(`${this.shopId}:${this.secretKey}`).toString('base64')

		const { status, data } = await this.httpsPost('/v3/payments', {
			amount: { value: amount.toFixed(2), currency: 'RUB' },
			confirmation: {
				type: 'redirect',
				return_url: `${this.configService.get('FRONTEND_URL')}/payment/success`,
			},
			capture: true,
			description: 'Пополнение баланса SkySEO',
		}, { Authorization: `Basic ${auth}`, 'Idempotence-Key': paymentId })

		console.log('[Payments] YooKassa response', { status, paymentId: data?.id, paymentStatus: data?.status })

		if (status < 200 || status >= 300) {
			console.error('[Payments] YooKassa error', { status, body: JSON.stringify(data).slice(0, 300) })
			throw new Error(`YooKassa error: ${data?.description || data?.message || 'Unknown error'}`)
		}

		return data
	}

	private async checkYooKassaPaymentStatus(externalId: string) {
		console.log('[Payments] Checking YooKassa payment status', { externalId })

		const auth = Buffer.from(`${this.shopId}:${this.secretKey}`).toString('base64')

		const { status, data } = await this.httpsGet(
			`/v3/payments/${externalId}`,
			{ Authorization: `Basic ${auth}` },
		)

		if (status < 200 || status >= 300) {
			console.error('[Payments] YooKassa status check error', {
				externalId,
				status,
				errorType: data.type,
				errorCode: data.code,
				errorDescription: data.description,
			})
			throw new Error(
				`YooKassa status check error: ${data.description || 'Unknown error'}`,
			)
		}

		console.log('[Payments] YooKassa status response', {
			externalId,
			status: data.status,
			paid: data.paid,
			amount: data.amount?.value,
		})

		return data
	}
}
