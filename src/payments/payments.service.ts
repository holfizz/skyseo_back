import { Injectable } from '@nestjs/common'
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
		const user = await this.usersService.findById(userId)

		// Создаем платеж в БД
		const payment = await this.prisma.payment.create({
			data: {
				userId,
				amount: dto.amount,
				points: dto.points,
				status: 'PENDING',
			},
		})

		// Создаем платеж в YooKassa
		const yooKassaPayment = await this.createYooKassaPayment(
			payment.id,
			dto.amount,
			user.email,
		)

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
		const { event, object } = body

		if (event === 'payment.succeeded') {
			const externalId = object.id
			const payment = await this.prisma.payment.findUnique({
				where: { externalId },
				include: { user: true },
			})

			if (!payment || payment.status === 'SUCCEEDED') {
				return { success: true }
			}

			// Обновляем статус платежа
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

			// Отправляем уведомления
			await this.telegramService.sendPaymentNotification(
				payment.user.email,
				Number(payment.amount),
				payment.points,
			)

			await this.notificationsService.sendPaymentSuccessEmail(
				payment.user.email,
				Number(payment.amount),
				payment.points,
			)
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
		const payment = await this.prisma.payment.findUnique({
			where: { id: paymentId },
		})

		if (!payment || payment.userId !== userId) {
			throw new Error('Payment not found')
		}

		return payment
	}

	private async createYooKassaPayment(
		paymentId: string,
		amount: number,
		email: string,
	) {
		// TODO: Интеграция с YooKassa API
		// Пример структуры запроса:
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

		return response.json()
	}
}
