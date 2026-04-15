import { Injectable } from '@nestjs/common'
import { NotificationsService } from '../notifications/notifications.service'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class UsersService {
	constructor(
		private prisma: PrismaService,
		private notificationsService: NotificationsService,
	) {}

	async create(data: {
		email: string
		password: string
		referralSource?: string
		city?: string
		lastLoginIp?: string
	}) {
		return this.prisma.user.create({
			data: {
				...data,
				registrationIp: data.lastLoginIp,
			},
		})
	}

	async findById(id: string) {
		return this.prisma.user.findUnique({
			where: { id },
		})
	}

	async findByEmail(email: string) {
		return this.prisma.user.findUnique({
			where: { email },
		})
	}

	async getProfile(userId: string) {
		return this.prisma.user.findUnique({
			where: { id: userId },
			select: {
				id: true,
				email: true,
				balance: true,
				role: true,
				referralSource: true,
				city: true,
				createdAt: true,
			},
		})
	}

	async updateBalance(
		userId: string,
		amount: number,
		type:
			| 'WELCOME_BONUS'
			| 'TASK_EARNED'
			| 'TASK_SPENT'
			| 'PAYMENT'
			| 'REFUND'
			| 'ADMIN_ADJUSTMENT',
		description: string,
		taskId?: string,
	) {
		const user = await this.prisma.user.update({
			where: { id: userId },
			data: {
				balance: {
					increment: amount,
				},
			},
		})

		await this.prisma.balanceHistory.create({
			data: {
				userId,
				amount,
				type,
				description,
				taskId,
			},
		})

		// Проверка низкого баланса
		if (user.balance < 100 && amount < 0) {
			await this.notificationsService.sendLowBalanceEmail(
				user.email,
				user.balance,
			)
		}

		return user
	}

	async getBalanceHistory(userId: string, limit = 50) {
		return this.prisma.balanceHistory.findMany({
			where: { userId },
			orderBy: { createdAt: 'desc' },
			take: limit,
		})
	}

	async countRecentRegistrationsByIp(ip: string): Promise<number> {
		const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
		return this.prisma.user.count({
			where: {
				registrationIp: ip,
				createdAt: { gte: oneHourAgo },
			},
		})
	}

	async markAsSuspicious(userId: string) {
		return this.prisma.user.update({
			where: { id: userId },
			data: { isSuspicious: true },
		})
	}

	async incrementFailedLogin(email: string) {
		const user = await this.findByEmail(email)
		if (!user) return

		const failedAttempts = user.failedLoginAttempts + 1

		await this.prisma.user.update({
			where: { id: user.id },
			data: {
				failedLoginAttempts: failedAttempts,
				lastFailedLogin: new Date(),
				isActive: failedAttempts >= 5 ? false : user.isActive, // Блокировка после 5 попыток
			},
		})
	}

	async resetFailedLogin(userId: string) {
		await this.prisma.user.update({
			where: { id: userId },
			data: {
				failedLoginAttempts: 0,
				lastFailedLogin: null,
			},
		})
	}
}
