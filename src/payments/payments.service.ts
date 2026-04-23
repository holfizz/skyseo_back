import { BadRequestException, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { NotificationsService } from '../notifications/notifications.service'
import { PrismaService } from '../prisma/prisma.service'
import { TelegramService } from '../telegram/telegram.service'
import { UsersService } from '../users/users.service'
import { CreatePaymentDto } from './dto'

@Injectable()
export class PaymentsService {
	private shopId: string
	private secretKey: string

	constructor(
		private prisma: PrismaService,
		private usersService: UsersService,
		private telegramService: TelegramService,
		private notificationsService: NotificationsService,
		private configService: ConfigService,
	) {
		this.shopId = this.configService.get('YOOKASSA_SHOP_ID')
		this.secretKey = this.configService.get('YOOKASSA_SECRET_KEY')
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
				include: { user: true },
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

			console.log('[Payments] Balance updated', {
				paymentId: payment.id,
				pointsAdded: payment.points,
			})

			// Отправляем уведомления
			try {
				await this.telegramService.sendPaymentNotification(
					payment.user.email,
					Number(payment.amount),
					payment.points,
				)
				console.log('[Payments] Telegram notification sent')
			} catch (error) {
				console.error('[Payments] Failed to send Telegram notification:', error)
			}

			try {
				await this.notificationsService.sendPaymentSuccessEmail(
					payment.user.email,
					Number(payment.amount),
					payment.points,
				)
				console.log('[Payments] Email notification sent')
			} catch (error) {
				console.error('[Payments] Failed to send email notification:', error)
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

	async getPaymentStatus(paymentId: string, userId: string) {
		console.log('[Payments] Getting payment status', {
			paymentId,
			userId: userId.substring(0, 8) + '...',
		})

		const payment = await this.prisma.payment.findUnique({
			where: { id: paymentId },
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
					console.log('[Payments] Payment succeeded, updating status')

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

					console.log('[Payments] Balance updated for payment', {
						paymentId: payment.id,
					})

					return { ...payment, status: 'SUCCEEDED' }
				}
			} catch (error) {
				console.error('[Payments] Failed to check YooKassa status:', error)
			}
		}

		return payment
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

		const auth = Buffer.from(`${this.shopId}:${this.secretKey}`).toString(
			'base64',
		)

		const response = await fetch('https://api.yookassa.ru/v3/payments', {
			method: 'POST',
			headers: {
				Authorization: `Basic ${auth}`,
				'Content-Type': 'application/json',
				'Idempotence-Key': paymentId,
			},
			body: JSON.stringify({
				amount: {
					value: amount.toFixed(2),
					currency: 'RUB',
				},
				confirmation: {
					type: 'redirect',
					return_url: `${this.configService.get('FRONTEND_URL')}/payment/success`,
				},
				capture: true,
				description: `Пополнение баланса SkySEO`,
				receipt: {
					customer: {
						email,
					},
					items: [
						{
							description: 'Баллы SkySEO',
							quantity: '1',
							amount: {
								value: amount.toFixed(2),
								currency: 'RUB',
							},
							vat_code: 1,
						},
					],
				},
			}),
		})

		const data = await response.json()

		if (!response.ok) {
			console.error('[Payments] YooKassa error', {
				status: response.status,
				errorType: data.type,
				errorCode: data.code,
			})
			throw new Error(`YooKassa error: ${data.description || 'Unknown error'}`)
		}

		return data
	}

	private async checkYooKassaPaymentStatus(externalId: string) {
		console.log('[Payments] Checking YooKassa payment status', { externalId })

		const auth = Buffer.from(`${this.shopId}:${this.secretKey}`).toString(
			'base64',
		)

		const response = await fetch(
			`https://api.yookassa.ru/v3/payments/${externalId}`,
			{
				method: 'GET',
				headers: {
					Authorization: `Basic ${auth}`,
					'Content-Type': 'application/json',
				},
			},
		)

		const data = await response.json()

		if (!response.ok) {
			console.error('[Payments] YooKassa status check error', {
				externalId,
				status: response.status,
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
