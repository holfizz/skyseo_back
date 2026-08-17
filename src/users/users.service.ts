import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { AppStatus, UserType } from '@prisma/client'
import { lookupPromoCode } from '../auth/promo-codes'
import { normalizeRoles, rolesOf, type RoleName } from '../common/roles'
import { daysLeft as calendarDaysLeft } from '../common/trial'
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

	/**
	 * Профиль пользователя. Читают ДВА клиента с разными требованиями:
	 *
	 *  1. Electron-приложение (v1.1.0, сборка 09.08.2026) — берёт отсюда balance.
	 *     Его пересобрать нельзя, поэтому набор полей менять запрещено: убирать
	 *     существующие нельзя, а новые оно просто игнорирует.
	 *  2. Веб-кабинет — читает daysLeft. Поле ниже помечено как совместимость:
	 *     новый код кабинета берёт остаток из getPromotionStatus, но пока старая
	 *     сборка фронта живёт на проде, убирать daysLeft отсюда НЕЛЬЗЯ — кабинет
	 *     получит undefined, покажет «0 дней» и пейволл. Это ровно то, что уже
	 *     один раз сломало сайт после выката бэка без фронта.
	 *
	 * Правило: бэк должен деплоиться в любом порядке с фронтом.
	 */
	async getProfile(userId: string) {
		const user = await this.prisma.user.findUnique({
			where: { id: userId },
			select: {
				id: true,
				email: true,
				balance: true,
				role: true,
				roles: true,
				emailVerified: true,
				paidUntil: true,
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
		// Дни для сайта считаем по расходу баллов (см. promotionDaysLeft).
		// null приводим к 0: старый кабинет ждёт число.
		const { days: promoDays } = await this.promotionDaysLeft(userId, user.paidUntil)

		const { telegramChatId, ...rest } = user
		return {
			...rest,
			// role остаётся строкой — её читает Electron-приложение, контракт не меняем.
			// roles — для сайта; для записей до миграции подставляем [role], чтобы массив не был пустым.
			roles: rolesOf(user),
			// СОВМЕСТИМОСТЬ для старой сборки веб-кабинета: она читает дни отсюда.
			// Считаем тем же способом, что и promotion-status — по расходу баллов,
			// без календаря. Иначе сайт показывал бы 29–30 дней всем подряд, потому
			// что paidUntil у всех выставлен на месяц вперёд.
			// Приложение это поле игнорирует, ему нужен только balance.
			daysLeft: promoDays,
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
	 * Сколько дней продвижения осталось. Считается ТОЛЬКО по календарю подписки
	 * (users.paidUntil): клиент покупает период, а не баллы, и в кабинете должен
	 * видеть свой срок.
	 *
	 * Раньше здесь было деление баланса на скорость расхода баллов. Цифра врала тем
	 * сильнее, чем медленнее крутился сайт: при 17 баллах в сутки кабинет показывал
	 * 557 дней вместо трёх недель оплаченного срока.
	 *
	 * ВНИМАНИЕ при возврате назад: у расчёта по баллам была своя причина — paidUntil
	 * был выставлен «месяц вперёд» одинаково всем, и календарь показывал 29–30 дней
	 * независимо от реальности. Календарь честен ровно настолько, насколько честны
	 * даты в базе.
	 *
	 * 0 дней = не оплачено (null или прошедшая дата) — кабинет показывает пейволл.
	 * spentPerDay остаётся в ответе /users/promotion-status как справочная цифра
	 * и на число дней больше не влияет.
	 */
	private async promotionDaysLeft(
		userId: string,
		paidUntil: Date | null,
	): Promise<{ days: number; spentPerDay: number }> {
		const WINDOW_DAYS = 7
		const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000)
		const spent = await this.prisma.balanceHistory.aggregate({
			where: { userId, type: 'TASK_SPENT', createdAt: { gte: since } },
			_sum: { amount: true },
		})
		// TASK_SPENT хранится отрицательным.
		const spentPerDay = Math.abs(spent._sum.amount ?? 0) / WINDOW_DAYS
		return { days: calendarDaysLeft(paidUntil), spentPerDay }
	}

	/**
	 * Остаток продвижения для веб-кабинета. Приложение эту ручку не знает и не зовёт:
	 * в нём остаются баллы (users/profile.balance), а дни — только на сайте.
	 */
	async getPromotionStatus(userId: string) {
		const user = await this.prisma.user.findUnique({
			where: { id: userId },
			select: { balance: true, paidUntil: true, trialStartedAt: true },
		})
		if (!user) throw new NotFoundException('Пользователь не найден')

		const { days, spentPerDay } = await this.promotionDaysLeft(userId, user.paidUntil)
		return {
			balance: user.balance,
			spentPerDay: Math.round(spentPerDay),
			// Даты отдаём для баннеров про бесплатную неделю. На число дней они
			// НЕ влияют — иначе вернётся календарь, который мы отсюда и убрали.
			paidUntil: user.paidUntil,
			trialStartedAt: user.trialStartedAt,
			daysLeft: days,
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
