import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { AppStatus, UserType } from '@prisma/client'
import { lookupPromoCode } from '../auth/promo-codes'
import { normalizeRoles, rolesOf, type RoleName } from '../common/roles'
import { NotificationsService } from '../notifications/notifications.service'
import { PrismaService } from '../prisma/prisma.service'
import { daysLeft } from '../common/trial'

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
		marketingCode?: string
		promoCode?: string
		city?: string
		lastLoginIp?: string
		registrationIp?: string
		emailVerificationToken?: string
		appVersion?: string
		appStatus?: AppStatus
		userType?: UserType
		telegramContact?: string
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

	/**
	 * ЕДИНСТВЕННОЕ место, где меняются роли. Пишет оба поля разом, чтобы role и roles
	 * никогда не разъехались: role = roles[0] («главная»), её читает Electron и старый код.
	 * Прямые обновления user.role в обход этого метода — запрещены.
	 */
	async setRoles(userId: string, roles: string[], primary?: string) {
		const normalized = normalizeRoles(roles, primary)
		return this.prisma.user.update({
			where: { id: userId },
			data: { roles: normalized as RoleName[], role: normalized[0] },
			select: { id: true, email: true, role: true, roles: true },
		})
	}

	/** Все роли пользователя с фолбэком на одиночное поле (для записей до миграции). */
	async getRoles(userId: string): Promise<string[]> {
		const user = await this.prisma.user.findUnique({
			where: { id: userId },
			select: { role: true, roles: true },
		})
		return rolesOf(user)
	}

	// Одноразовая привязка реферала из профиля — для тех, кто пропустил момент при
	// регистрации. Привязать можно один раз: если referredBy уже стоит — изменить нельзя.
	// Единое поле: принимает И промокод, И код друга (как при регистрации).
	async claimReferral(userId: string, code: string) {
		const normalized = code?.trim().toUpperCase()
		console.log(`[claimReferral] userId=${userId?.slice(0, 8)} received=${JSON.stringify(code)} normalized=${JSON.stringify(normalized)}`)
		if (!normalized) throw new BadRequestException('Код не указан')

		const user = await this.prisma.user.findUnique({
			where: { id: userId },
			select: { referredBy: true, referralCode: true, promoCode: true },
		})
		if (!user) throw new NotFoundException('Пользователь не найден')

		// 1) Промокод (таблица promo_codes) — бонус новичку, один раз
		const promo = await lookupPromoCode(this.prisma, normalized)
		if (promo) {
			if (user.promoCode) throw new BadRequestException(`Уже активирован промокод ${user.promoCode} — другой применить нельзя`)
			await this.prisma.user.update({
				where: { id: userId },
				data: { promoCode: promo.code, balance: { increment: promo.bonusPoints } },
			})
			await this.prisma.balanceHistory.create({
				data: {
					userId,
					amount: promo.bonusPoints,
					type: 'REFERRAL_BONUS',
					description: `Промокод ${promo.code}${promo.description ? ': ' + promo.description : ''}`,
				},
			})
			console.log(`[claimReferral] promo applied: ${promo.code} +${promo.bonusPoints}`)
			return { ok: true, kind: 'promo', bonusPoints: promo.bonusPoints }
		}

		// 2) Реферальный код друга (users.referralCode) — привязка referredBy, один раз
		if (user.referralCode === normalized) throw new BadRequestException('Нельзя указать свой код')
		const referrer = await this.prisma.user.findUnique({
			where: { referralCode: normalized },
			select: { id: true },
		})
		if (referrer) {
			if (user.referredBy) throw new BadRequestException('Реферал уже привязан — изменить нельзя')
			if (referrer.id === userId) throw new BadRequestException('Нельзя пригласить самого себя')
			await this.prisma.user.update({
				where: { id: userId },
				data: { referredBy: referrer.id },
			})
			console.log(`[claimReferral] referral bound: ${normalized}`)
			return { ok: true, kind: 'referral' }
		}

		console.log(`[claimReferral] NOT FOUND: ${normalized} (нет ни в promo_codes, ни в users.referralCode)`)
		throw new BadRequestException('Код не найден')
	}

	async getProfile(userId: string) {
		const user = await this.prisma.user.findUnique({
			where: { id: userId },
			select: {
				id: true,
				email: true,
				balance: true,
				paidUntil: true, // до какой даты оплачено продвижение
				trialStartedAt: true, // старт бесплатной недели; null = ещё не начиналась
				role: true,
				roles: true,
				emailVerified: true,
				referralSource: true,
				referralCode: true,
				referredBy: true,
				city: true,
				createdAt: true,
				telegramChatId: true,
				telegramUsername: true,
			},
		})
		if (!user) return user
		const paidCount = await this.prisma.payment.count({
			where: { userId, status: 'SUCCEEDED' },
		})
		const { telegramChatId, ...rest } = user
		return {
			...rest,
			// role остаётся строкой — её читает Electron-приложение, контракт не меняем.
			// roles — для сайта; для записей до миграции подставляем [role], чтобы массив не был пустым.
			roles: rolesOf(user),
			daysLeft: daysLeft(user.paidUntil), // сколько дней продвижения осталось
			telegramLinked: !!telegramChatId, // привязан ли Telegram-бот уведомлений
			hasPaid: paidCount > 0, // была ли хоть одна успешная оплата (снимает лимиты)
		}
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
		// Баллы — валюта участника сети, один кошелёк. Продвижение ими не оплачивается:
		// веб-версия работает на днях подписки (users.paidUntil).
		const user = await this.prisma.user.update({
			where: { id: userId },
			data: { balance: { increment: amount } },
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

	/**
	 * Сколько дней продвижения осталось — для веб-кабинета.
	 *
	 * Продвижение оплачивается баллами (так же, как в приложении), поэтому «дни»
	 * считаются не по календарю, а по расходу: сколько ещё продержится текущий
	 * баланс при среднем списании за последнюю неделю. Это честный ответ на вопрос
	 * «сколько мне осталось», в отличие от фиксированных 30 дней.
	 *
	 * Если списаний ещё не было (сайт только завели, визиты не пошли), скорость
	 * расхода неизвестна — возвращаем daysLeft: null, и кабинет показывает баллы
	 * вместо выдуманного срока.
	 *
	 * paidUntil отдаём как есть: если подписка когда-то была проставлена и ещё не
	 * истекла, кабинет показывает больший из двух сроков.
	 */
	async getPromotionStatus(userId: string) {
		const WINDOW_DAYS = 7
		const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000)

		const [user, spent] = await Promise.all([
			this.prisma.user.findUnique({
				where: { id: userId },
				select: { balance: true, paidUntil: true, trialStartedAt: true },
			}),
			this.prisma.balanceHistory.aggregate({
				where: { userId, type: 'TASK_SPENT', createdAt: { gte: since } },
				_sum: { amount: true },
			}),
		])
		if (!user) throw new NotFoundException('Пользователь не найден')

		// TASK_SPENT хранится отрицательным.
		const spentPerDay = Math.abs(spent._sum.amount ?? 0) / WINDOW_DAYS
		const bySubscription = daysLeft(user.paidUntil)
		// Пустой баланс — это ноль дней, а не «неизвестно»: продвижение уже стоит,
		// и кабинет должен показать это, даже если списаний за неделю не было.
		const byPoints =
			user.balance <= 0 ? 0 : spentPerDay > 0 ? Math.floor(user.balance / spentPerDay) : null

		return {
			balance: user.balance,
			spentPerDay: Math.round(spentPerDay),
			paidUntil: user.paidUntil,
			trialStartedAt: user.trialStartedAt,
			// Больший из двух сроков: подписка не должна укорачивать запас баллов.
			daysLeft: byPoints === null ? (bySubscription || null) : Math.max(byPoints, bySubscription),
		}
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
