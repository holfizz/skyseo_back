import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { UserType } from '@prisma/client'
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
		referralCode?: string
		referredBy?: string
		promoCode?: string
		city?: string
		lastLoginIp?: string
		registrationIp?: string
		emailVerificationToken?: string
		appVersion?: string
		userType?: UserType
	}) {
		return this.prisma.user.create({
			data: {
				...data,
				registrationIp: data.registrationIp || data.lastLoginIp,
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

	// Одноразовая привязка реферала из профиля — для тех, кто пропустил момент при
	// регистрации. Привязать можно один раз: если referredBy уже стоит — изменить нельзя.
	async claimReferral(userId: string, code: string) {
		const normalized = code?.trim().toUpperCase()
		if (!normalized) throw new BadRequestException('Код не указан')

		const user = await this.prisma.user.findUnique({
			where: { id: userId },
			select: { referredBy: true, referralCode: true },
		})
		if (!user) throw new NotFoundException('Пользователь не найден')
		if (user.referredBy) throw new BadRequestException('Реферал уже привязан — изменить нельзя')
		if (user.referralCode === normalized) throw new BadRequestException('Нельзя указать свой код')

		const referrer = await this.prisma.user.findUnique({
			where: { referralCode: normalized },
			select: { id: true },
		})
		if (!referrer) throw new BadRequestException('Код не найден')
		if (referrer.id === userId) throw new BadRequestException('Нельзя пригласить самого себя')

		await this.prisma.user.update({
			where: { id: userId },
			data: { referredBy: referrer.id },
		})
		return { ok: true }
	}

	async getProfile(userId: string) {
		return this.prisma.user.findUnique({
			where: { id: userId },
			select: {
				id: true,
				email: true,
				balance: true,
				role: true,
				emailVerified: true,
				referralSource: true,
				referralCode: true,
				referredBy: true,
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
			| 'ADMIN_ADJUSTMENT'
			| 'REFERRAL_BONUS',
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

		if (user.balance < 100 && amount < 0) {
			this.notificationsService.sendLowBalanceEmail(user.email, user.balance).catch(() => {})
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
