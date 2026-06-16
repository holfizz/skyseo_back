import { Injectable } from '@nestjs/common'
import {
	AppConfigService,
	DEFAULT_GOOGLE_CONSENT,
	DEFAULT_GOOGLE_SOCS,
	KEY_GOOGLE_CONSENT,
	KEY_GOOGLE_SOCS,
	KEY_POINTS_FOUND_EARNED,
	KEY_POINTS_FOUND_SPENT,
	KEY_POINTS_NOT_FOUND_EARNED,
	KEY_POINTS_NOT_FOUND_SPENT,
} from '../app-config/app-config.service'
import { NotificationsService } from '../notifications/notifications.service'
import { PrismaService } from '../prisma/prisma.service'
import { UsersService } from '../users/users.service'

@Injectable()
export class AdminService {
	constructor(
		private prisma: PrismaService,
		private usersService: UsersService,
		private appConfig: AppConfigService,
		private notifications: NotificationsService,
	) {}

	async getGoogleConfigForAdmin() {
		const [socs, consent] = await Promise.all([
			this.appConfig.getWithMeta(KEY_GOOGLE_SOCS, DEFAULT_GOOGLE_SOCS),
			this.appConfig.getWithMeta(KEY_GOOGLE_CONSENT, DEFAULT_GOOGLE_CONSENT),
		])
		return { socs, consent }
	}

	async setGoogleConfig(body: { socs?: string; consent?: string }) {
		if (typeof body.socs === 'string') await this.appConfig.set(KEY_GOOGLE_SOCS, body.socs.trim())
		if (typeof body.consent === 'string') await this.appConfig.set(KEY_GOOGLE_CONSENT, body.consent.trim())
		return this.getGoogleConfigForAdmin()
	}

	async getPointsConfig() {
		return this.appConfig.getPointsConfigWithMeta()
	}

	async setPointsConfig(body: { foundEarned?: number; foundSpent?: number; notFoundEarned?: number; notFoundSpent?: number }) {
		if (body.foundEarned != null) await this.appConfig.set(KEY_POINTS_FOUND_EARNED, String(body.foundEarned))
		if (body.foundSpent != null) await this.appConfig.set(KEY_POINTS_FOUND_SPENT, String(body.foundSpent))
		if (body.notFoundEarned != null) await this.appConfig.set(KEY_POINTS_NOT_FOUND_EARNED, String(body.notFoundEarned))
		if (body.notFoundSpent != null) await this.appConfig.set(KEY_POINTS_NOT_FOUND_SPENT, String(body.notFoundSpent))
		return this.appConfig.getPointsConfigWithMeta()
	}

	async setUserBoost(userId: string, boost: number) {
		const clamped = Math.max(1, Math.min(100, Math.round(boost)))
		await this.prisma.user.update({ where: { id: userId }, data: { priorityBoost: clamped } })
		return { priorityBoost: clamped }
	}

	// Ёмкость сети: текущий override активных ПК + посчитанные числа потолка
	async getNetworkConfig() {
		const override = await this.appConfig.getNetworkActivePcsOverride()
		const info = await this.appConfig.getNetworkCapacityInfo()
		return { override, ...info }
	}

	async setNetworkConfig(body: { activePcs?: number | null }) {
		await this.appConfig.setNetworkActivePcs(body.activePcs ?? null)
		return this.getNetworkConfig()
	}

	// Админ правит просмотры/день и режим у ЛЮБОГО сайта (без проверки владельца).
	async updateWebsite(
		websiteId: string,
		body: { dailyVisitsTarget?: number | null; autoMaxVisits?: boolean },
	) {
		const data: { dailyVisitsTarget?: number | null; autoMaxVisits?: boolean } = {}
		if (body.dailyVisitsTarget !== undefined) {
			data.dailyVisitsTarget =
				body.dailyVisitsTarget != null && body.dailyVisitsTarget > 0
					? Math.round(body.dailyVisitsTarget)
					: null
		}
		if (body.autoMaxVisits !== undefined) data.autoMaxVisits = body.autoMaxVisits
		return this.prisma.website.update({ where: { id: websiteId }, data })
	}

	async getAdminStatistics() {
		const [
			totalUsers,
			activeUsers,
			totalWebsites,
			totalTasks,
			pendingTasks,
			completedTasks,
			totalExecutions,
			totalPayments,
			totalRevenue,
			systemBalance,
		] = await Promise.all([
			this.prisma.user.count(),
			this.prisma.user.count({ where: { isActive: true } }),
			this.prisma.website.count(),
			this.prisma.task.count(),
			this.prisma.task.count({ where: { status: 'PENDING' } }),
			this.prisma.task.count({ where: { status: 'COMPLETED' } }),
			this.prisma.execution.count(),
			this.prisma.payment.count({ where: { status: 'SUCCEEDED' } }),
			this.prisma.payment.aggregate({
				where: { status: 'SUCCEEDED' },
				_sum: { amount: true },
			}),
			this.prisma.user.aggregate({ _sum: { balance: true } }),
		])

		// Активные пользователи за последние 24 часа
		const yesterday = new Date()
		yesterday.setDate(yesterday.getDate() - 1)

		const activeUsersLast24h = await this.prisma.execution.groupBy({
			by: ['executorId'],
			where: { createdAt: { gte: yesterday } },
		})

		// Активные пользователи прямо сейчас (за последние 5 минут)
		const fiveMinutesAgo = new Date()
		fiveMinutesAgo.setMinutes(fiveMinutesAgo.getMinutes() - 5)

		const activeUsersNow = await this.prisma.execution.groupBy({
			by: ['executorId'],
			where: { createdAt: { gte: fiveMinutesAgo } },
		})

		// Ёмкость сети: активных ПК за неделю, среднее/день и максимум просмотров/день
		// (ceil(среднее/14)) — то же число, что видит владелец при создании сайта.
		const capacity = await this.appConfig.getNetworkCapacityInfo()

		return {
			network: {
				activePcsWeek: capacity.activePcsWeek,
				avgPerDay: capacity.avgPerDay,
				maxViewsPerDay: capacity.maxPerDay,
			},
			users: {
				total: totalUsers,
				active: activeUsers,
				activeToday: activeUsersLast24h.length,
				activeNow: activeUsersNow.length,
			},
			websites: {
				total: totalWebsites,
			},
			tasks: {
				total: totalTasks,
				pending: pendingTasks,
				completed: completedTasks,
			},
			executions: {
				total: totalExecutions,
			},
			payments: {
				total: totalPayments,
				revenue: Number(totalRevenue._sum.amount || 0),
			},
			balance: {
				system: systemBalance._sum.balance || 0,
			},
		}
	}

	async getAllUsers(search = '', offset = 0, limit = 100, sortBy = 'createdAt', sortDir: 'asc' | 'desc' = 'desc') {
		const where = search ? {
			OR: [
				{ email: { contains: search, mode: 'insensitive' as const } },
				{ city: { contains: search, mode: 'insensitive' as const } },
			],
		} : {}
		const orderBy =
			sortBy === 'websites' ? { websites: { _count: sortDir } } :
			sortBy === 'executions' ? { executions: { _count: sortDir } } :
			{ [['email','balance','city','isActive','createdAt','appVersion','role','appStatus'].includes(sortBy) ? sortBy : 'createdAt']: sortDir }
		const select = {
			id: true,
			email: true,
			balance: true,
			role: true,
			city: true,
			promoCode: true,
			referralSource: true,
			isActive: true,
			lastSeenAt: true,
			appVersion: true,
			appStatus: true,
			createdAt: true,
			_count: {
				select: {
					websites: true,
					executions: true,
					payments: true,
				},
			},
		}
		const [users, total] = await Promise.all([
			this.prisma.user.findMany({ select, where, orderBy, skip: offset, take: limit }),
			this.prisma.user.count({ where }),
		])
		return { users, total, offset, limit }
	}

	async getAllSites(search = '', offset = 0, limit = 100, sortBy = 'createdAt', sortDir: 'asc' | 'desc' = 'desc') {
		const where: any = search ? {
			OR: [
				{ url: { contains: search, mode: 'insensitive' as const } },
				{ name: { contains: search, mode: 'insensitive' as const } },
				{ user: { email: { contains: search, mode: 'insensitive' as const } } },
			],
		} : {}
		const orderBy: any =
			sortBy === 'tasks' ? { tasks: { _count: sortDir } } :
			{ [['name', 'url', 'createdAt', 'isActive'].includes(sortBy) ? sortBy : 'createdAt']: sortDir }
		const [sites, total] = await Promise.all([
			this.prisma.website.findMany({
				where,
				select: {
					id: true,
					name: true,
					url: true,
					isActive: true,
					createdAt: true,
					user: { select: { id: true, email: true } },
					_count: { select: { tasks: true } },
				},
				orderBy,
				skip: offset,
				take: limit,
			}),
			this.prisma.website.count({ where }),
		])
		const siteIds = sites.map(s => s.id)
		const [execAll, execCompleted, execFailed] = await Promise.all([
			this.prisma.execution.groupBy({ by: ['websiteId'], where: { websiteId: { in: siteIds } }, _count: { id: true } }),
			this.prisma.execution.groupBy({ by: ['websiteId'], where: { websiteId: { in: siteIds }, status: 'COMPLETED' }, _count: { id: true } }),
			this.prisma.execution.groupBy({ by: ['websiteId'], where: { websiteId: { in: siteIds }, status: 'FAILED' }, _count: { id: true } }),
		])
		const totalMap = new Map(execAll.map(e => [e.websiteId, e._count.id]))
		const completedMap = new Map(execCompleted.map(e => [e.websiteId, e._count.id]))
		const failedMap = new Map(execFailed.map(e => [e.websiteId, e._count.id]))
		return {
			sites: sites.map(s => ({
				...s,
				totalExecutions: totalMap.get(s.id) ?? 0,
				completedExecutions: completedMap.get(s.id) ?? 0,
				failedExecutions: failedMap.get(s.id) ?? 0,
			})),
			total,
			offset,
			limit,
		}
	}

	async getUserDetails(userId: string) {
		const [user, totalExecutions, completedExecutions] = await Promise.all([
			this.prisma.user.findUnique({
				where: { id: userId },
				include: {
					websites: {
						include: {
							tasks: {
								orderBy: { createdAt: 'desc' },
								select: {
									id: true,
									keyword: true,
									type: true,
									isActive: true,
									keywordStatus: true,
									useYandex: true,
									useGoogle: true,
									maxYandexVisits: true,
									maxGoogleVisits: true,
									_count: { select: { executions: true } },
								},
							},
						},
					},
					balanceHistory: {
						orderBy: { createdAt: 'desc' },
						take: 50,
					},
					payments: {
						orderBy: { createdAt: 'desc' },
						take: 20,
					},
					executions: {
						orderBy: { createdAt: 'desc' },
						take: 20,
						include: {
							task: {
								include: {
									website: true,
								},
							},
						},
					},
				},
			}),
			this.prisma.execution.count({ where: { executorId: userId } }),
			this.prisma.execution.count({ where: { executorId: userId, status: 'COMPLETED' } }),
		])
		if (!user) return null
		return { ...user, totalExecutions, completedExecutions }
	}

	async adjustUserBalance(userId: string, amount: number, description: string) {
		return this.usersService.updateBalance(
			userId,
			amount,
			'ADMIN_ADJUSTMENT',
			description,
		)
	}

	async toggleUserActive(userId: string) {
		const user = await this.prisma.user.findUnique({
			where: { id: userId },
		})

		return this.prisma.user.update({
			where: { id: userId },
			data: { isActive: !user.isActive },
		})
	}

	async getAllTasks(limit = 100) {
		return this.prisma.task.findMany({
			include: {
				website: {
					include: {
						user: {
							select: {
								id: true,
								email: true,
							},
						},
					},
				},
				executions: true,
			},
			orderBy: { createdAt: 'desc' },
			take: limit,
		})
	}

	async getAllExecutions(limit = 100) {
		return this.prisma.execution.findMany({
			include: {
				task: {
					include: {
						website: true,
					},
				},
				executor: {
					select: {
						id: true,
						email: true,
					},
				},
			},
			orderBy: { createdAt: 'desc' },
			take: limit,
		})
	}

	async getAllPayments(limit = 100) {
		return this.prisma.payment.findMany({
			include: {
				user: {
					select: {
						id: true,
						email: true,
					},
				},
			},
			orderBy: { createdAt: 'desc' },
			take: limit,
		})
	}

	async getInactiveUsers(days: number) {
		const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
		// Пользователи у которых нет ни одного completed execution за последние N дней
		// (значит приложение не работало — оно создаёт executions только когда запущено)
		const users = await this.prisma.$queryRaw<Array<{
			id: string
			email: string
			balance: number
			promoCode: string | null
			lastSeenAt: Date | null
			lastExecution: Date | null
			createdAt: Date
			city: string | null
			appVersion: string | null
		}>>`
			SELECT u.id, u.email, u.balance, u."promoCode", u."lastSeenAt",
			       u."createdAt", u.city, u."appVersion",
			       MAX(e."completedAt") AS "lastExecution"
			FROM users u
			LEFT JOIN executions e ON e."executorId" = u.id AND e.status = 'COMPLETED'
			WHERE u.role = 'USER'
			GROUP BY u.id
			HAVING MAX(e."completedAt") IS NULL OR MAX(e."completedAt") < ${cutoff}
			ORDER BY MAX(e."completedAt") DESC NULLS LAST
			LIMIT 500
		`
		return {
			days,
			total: users.length,
			users: users.map(u => ({
				...u,
				daysSinceLastExecution: u.lastExecution
					? Math.floor((Date.now() - new Date(u.lastExecution).getTime()) / 86400000)
					: null,
			})),
		}
	}

	async getPromoCodeUsers(code: string, inactiveDays?: number, appStatus?: string) {
		const normalized = code.trim().toUpperCase()

		const allUsers = await this.prisma.$queryRaw<Array<{
			id: string
			email: string
			balance: number
			lastSeenAt: Date | null
			createdAt: Date
			city: string | null
			appStatus: string
			appVersion: string | null
		}>>`
			SELECT id, email, balance, "lastSeenAt", "createdAt", city, "appStatus", "appVersion"
			FROM users
			WHERE "promoCode" = ${normalized}
			ORDER BY "createdAt" DESC
		`

		const withOffline = allUsers.map(u => ({
			...u,
			daysOffline: u.lastSeenAt
				? Math.floor((Date.now() - new Date(u.lastSeenAt).getTime()) / 86400000)
				: null,
		}))

		let filtered = withOffline
		if (inactiveDays) {
			filtered = filtered.filter(u => u.daysOffline === null || u.daysOffline >= inactiveDays)
		}
		if (appStatus) {
			filtered = filtered.filter(u => u.appStatus === appStatus)
		}

		return {
			code: normalized,
			inactiveDays: inactiveDays ?? null,
			appStatus: appStatus ?? null,
			total: filtered.length,
			totalAll: allUsers.length,
			users: filtered,
		}
	}

	async getPromoCodesStats() {
		// Все юзеры с промокодом (используем raw чтобы избежать рекурсивных типов Prisma groupBy)
		const usersByCode = await this.prisma.$queryRaw<Array<{
			id: string
			email: string
			balance: number
			promoCode: string
			createdAt: Date
		}>>`
			SELECT id, email, balance, "promoCode", "createdAt"
			FROM users
			WHERE "promoCode" IS NOT NULL
			ORDER BY "createdAt" DESC
		`

		// Сумма бонусов по userId
		const bonusesByUser = await this.prisma.balanceHistory.groupBy({
			by: ['userId'],
			where: { type: 'REFERRAL_BONUS', description: { startsWith: 'Промокод' } },
			_sum: { amount: true },
		})
		const bonusMap = new Map(bonusesByUser.map(b => [b.userId, b._sum.amount ?? 0]))

		const stats: Record<string, {
			code: string
			usersCount: number
			totalBonusGiven: number
			users: Array<{ id: string; email: string; balance: number; joinedAt: Date }>
		}> = {}

		for (const u of usersByCode) {
			const code = u.promoCode
			if (!stats[code]) {
				stats[code] = { code, usersCount: 0, totalBonusGiven: 0, users: [] }
			}
			stats[code].usersCount++
			stats[code].totalBonusGiven += bonusMap.get(u.id) ?? 0
			stats[code].users.push({
				id: u.id,
				email: u.email,
				balance: u.balance,
				joinedAt: u.createdAt,
			})
		}

		return {
			total: usersByCode.length,
			codes: Object.values(stats).sort((a, b) => b.usersCount - a.usersCount),
		}
	}

	// ─── Промокоды CRUD ───

	async listPromoCodes() {
		const codes = await this.prisma.promoCode.findMany({
			orderBy: { createdAt: 'desc' },
		})
		const stats = await this.prisma.$queryRaw<Array<{
			promoCode: string
			total: bigint
			uninstalled: bigint
			active: bigint
			stayed_week: bigint
			stayed_month: bigint
			avg_days_to_uninstall: any
			paying_count: bigint
			total_revenue: any
			avg_tasks: any
		}>>`
			WITH user_tasks AS (
				SELECT "executorId" AS user_id, COUNT(*)::bigint AS task_count
				FROM execution_events
				GROUP BY "executorId"
			),
			user_payments AS (
				SELECT "userId" AS user_id,
					BOOL_OR(status = 'SUCCEEDED') AS has_paid,
					COALESCE(SUM(CASE WHEN status = 'SUCCEEDED' THEN amount ELSE 0 END), 0) AS paid_amount
				FROM payments
				GROUP BY "userId"
			)
			SELECT
				u."promoCode",
				COUNT(*)::bigint AS total,
				COUNT(*) FILTER (WHERE u."appStatus" = 'UNINSTALLED')::bigint AS uninstalled,
				COUNT(*) FILTER (WHERE u."appStatus" IN ('ACTIVE', 'REINSTALLED'))::bigint AS active,
				COUNT(*) FILTER (WHERE u."appStatus" IN ('ACTIVE', 'REINSTALLED') AND u."createdAt" <= NOW() - INTERVAL '7 days')::bigint AS stayed_week,
				COUNT(*) FILTER (WHERE u."appStatus" IN ('ACTIVE', 'REINSTALLED') AND u."createdAt" <= NOW() - INTERVAL '30 days')::bigint AS stayed_month,
				ROUND(AVG(CASE WHEN u."appStatus" = 'UNINSTALLED' AND u."lastSeenAt" IS NOT NULL
					THEN EXTRACT(EPOCH FROM (u."lastSeenAt" - u."createdAt")) / 86400.0 END)::numeric, 1) AS avg_days_to_uninstall,
				COUNT(*) FILTER (WHERE up.has_paid = true)::bigint AS paying_count,
				COALESCE(SUM(up.paid_amount), 0) AS total_revenue,
				ROUND(COALESCE(AVG(COALESCE(ut.task_count, 0)), 0)::numeric, 1) AS avg_tasks
			FROM users u
			LEFT JOIN user_payments up ON up.user_id = u.id
			LEFT JOIN user_tasks ut ON ut.user_id = u.id
			WHERE u."promoCode" IS NOT NULL
			GROUP BY u."promoCode"
		`
		const sm = new Map(stats.map(s => [s.promoCode, s]))
		return codes.map(c => {
			const s = sm.get(c.code)
			return {
				...c,
				usersCount: s ? Number(s.total) : 0,
				uninstalledCount: s ? Number(s.uninstalled) : 0,
				activeCount: s ? Number(s.active) : 0,
				stayedWeek: s ? Number(s.stayed_week) : 0,
				stayedMonth: s ? Number(s.stayed_month) : 0,
				avgDaysToUninstall: s?.avg_days_to_uninstall != null ? Number(s.avg_days_to_uninstall) : null,
				payingCount: s ? Number(s.paying_count) : 0,
				totalRevenue: s ? Number(s.total_revenue) : 0,
				avgTasks: s ? Number(s.avg_tasks) : 0,
			}
		})
	}

	async createPromoCode(data: { code: string; bonusPoints: number; description?: string; isActive?: boolean; budgetAmount?: number | null }) {
		const code = data.code.trim().toUpperCase()
		if (!code || code.length < 2) {
			throw new Error('Промокод должен быть минимум 2 символа')
		}
		if (!/^[A-Z0-9_-]+$/.test(code)) {
			throw new Error('Промокод: только латиница, цифры, _ и -')
		}
		const bonusPoints = Math.max(0, Math.floor(data.bonusPoints))
		return this.prisma.promoCode.create({
			data: {
				code,
				bonusPoints,
				description: data.description?.trim() || null,
				isActive: data.isActive !== false,
				budgetAmount: data.budgetAmount != null && data.budgetAmount > 0 ? data.budgetAmount : null,
			},
		})
	}

	async updatePromoCode(id: string, data: { code?: string; bonusPoints?: number; description?: string | null; isActive?: boolean; budgetAmount?: number | null; budgetMode?: string }) {
		const patch: any = {}
		if (data.code !== undefined) {
			const code = data.code.trim().toUpperCase()
			if (!/^[A-Z0-9_-]+$/.test(code)) {
				throw new Error('Промокод: только латиница, цифры, _ и -')
			}
			patch.code = code
		}
		if (data.bonusPoints !== undefined) patch.bonusPoints = Math.max(0, Math.floor(data.bonusPoints))
		if (data.description !== undefined) patch.description = data.description?.trim() || null
		if (data.isActive !== undefined) patch.isActive = data.isActive
		if (data.budgetAmount !== undefined) patch.budgetAmount = data.budgetAmount != null && data.budgetAmount > 0 ? data.budgetAmount : null
		if (data.budgetMode !== undefined) patch.budgetMode = data.budgetMode === 'per_install' ? 'per_install' : 'total'
		return this.prisma.promoCode.update({ where: { id }, data: patch })
	}

	async deletePromoCode(id: string) {
		return this.prisma.promoCode.delete({ where: { id } })
	}

	// ─── Воронка CRUD ───

	async listFunnelEntries(limit: number = 200) {
		return this.prisma.funnelEntry.findMany({
			orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
			take: Math.min(limit, 1000),
		})
	}

	async listFunnelChannels(): Promise<string[]> {
		const rows = await this.prisma.$queryRaw<Array<{ channel: string }>>`
			SELECT DISTINCT channel FROM funnel_entries ORDER BY channel ASC
		`
		return rows.map(r => r.channel)
	}

	async createFunnelEntry(data: {
		date: string
		channel: string
		views?: number
		cost?: number
		registrations?: number
		purchases?: number
		revenue?: number
		note?: string
	}) {
		const channel = data.channel.trim()
		if (!channel) throw new Error('Канал не указан')
		return this.prisma.funnelEntry.create({
			data: {
				date: new Date(data.date),
				channel,
				views: Math.max(0, Math.floor(data.views ?? 0)),
				cost: Math.max(0, Math.floor(data.cost ?? 0)),
				registrations: Math.max(0, Math.floor(data.registrations ?? 0)),
				purchases: Math.max(0, Math.floor(data.purchases ?? 0)),
				revenue: Math.max(0, Math.floor(data.revenue ?? 0)),
				note: data.note?.trim() || null,
			},
		})
	}

	async updateFunnelEntry(id: string, data: {
		date?: string
		channel?: string
		views?: number
		cost?: number
		registrations?: number
		purchases?: number
		revenue?: number
		note?: string | null
	}) {
		const patch: any = {}
		if (data.date) patch.date = new Date(data.date)
		if (data.channel !== undefined) patch.channel = data.channel.trim()
		if (data.views !== undefined) patch.views = Math.max(0, Math.floor(data.views))
		if (data.cost !== undefined) patch.cost = Math.max(0, Math.floor(data.cost))
		if (data.registrations !== undefined) patch.registrations = Math.max(0, Math.floor(data.registrations))
		if (data.purchases !== undefined) patch.purchases = Math.max(0, Math.floor(data.purchases))
		if (data.revenue !== undefined) patch.revenue = Math.max(0, Math.floor(data.revenue))
		if (data.note !== undefined) patch.note = data.note?.trim() || null
		return this.prisma.funnelEntry.update({ where: { id }, data: patch })
	}

	async deleteFunnelEntry(id: string) {
		return this.prisma.funnelEntry.delete({ where: { id } })
	}

	// ─── Яндекс РСЯ кампании ───

	async listYandexCampaigns() {
		return this.prisma.yandexAdCampaign.findMany({
			orderBy: { createdAt: 'desc' },
			include: { keywords: { orderBy: { createdAt: 'asc' } } },
		})
	}

	async createYandexCampaign(data: any) {
		return this.prisma.yandexAdCampaign.create({
			data: {
				name: data.name?.trim() || null,
				geo: data.geo?.trim() || null,
				landingUrl: data.landingUrl?.trim() || null,
				dailyBudget: Math.max(0, Math.floor(data.dailyBudget ?? 0)),
				adsHeadlines: data.adsHeadlines ?? null,
				adsDescriptions: data.adsDescriptions ?? null,
				notes: data.notes ?? null,
			},
			include: { keywords: true },
		})
	}

	async updateYandexCampaign(id: string, data: any) {
		const patch: any = {}
		for (const k of ['name', 'geo', 'landingUrl', 'adsHeadlines', 'adsDescriptions', 'notes']) {
			if (data[k] !== undefined) patch[k] = data[k]?.trim?.() ?? data[k] ?? null
		}
		if (data.dailyBudget !== undefined) patch.dailyBudget = Math.max(0, Math.floor(data.dailyBudget))
		for (const k of ['avatarOk', 'keywordsResearchOk', 'analyticsOk', 'triadLinkOk']) {
			if (data[k] !== undefined) patch[k] = !!data[k]
		}
		return this.prisma.yandexAdCampaign.update({ where: { id }, data: patch })
	}

	async deleteYandexCampaign(id: string) {
		return this.prisma.yandexAdCampaign.delete({ where: { id } })
	}

	async addYandexKeyword(campaignId: string, data: any) {
		return this.prisma.yandexAdKeyword.create({
			data: {
				campaignId,
				keyword: (data.keyword ?? '').trim(),
				frequency: Math.max(0, Math.floor(data.frequency ?? 0)),
				estimatedCpc: Math.max(0, Math.floor(data.estimatedCpc ?? 0)),
				competition: data.competition?.trim() || null,
				shouldLaunch: !!data.shouldLaunch,
			},
		})
	}

	async updateYandexKeyword(id: string, data: any) {
		const patch: any = {}
		if (data.keyword !== undefined) patch.keyword = String(data.keyword).trim()
		if (data.frequency !== undefined) patch.frequency = Math.max(0, Math.floor(data.frequency))
		if (data.estimatedCpc !== undefined) patch.estimatedCpc = Math.max(0, Math.floor(data.estimatedCpc))
		if (data.competition !== undefined) patch.competition = data.competition?.trim() || null
		if (data.shouldLaunch !== undefined) patch.shouldLaunch = !!data.shouldLaunch
		return this.prisma.yandexAdKeyword.update({ where: { id }, data: patch })
	}

	async deleteYandexKeyword(id: string) {
		return this.prisma.yandexAdKeyword.delete({ where: { id } })
	}

	// ─── Telegram посевы ───

	async listTelegramCampaigns() {
		return this.prisma.telegramAdCampaign.findMany({
			orderBy: { createdAt: 'desc' },
			include: { channels: { orderBy: { createdAt: 'asc' } } },
		})
	}

	async createTelegramCampaign(data: any) {
		return this.prisma.telegramAdCampaign.create({
			data: {
				name: data.name?.trim() || null,
				postText: data.postText ?? null,
				landingUrl: data.landingUrl?.trim() || null,
				budget: Math.max(0, Math.floor(data.budget ?? 0)),
				expectedViews: Math.max(0, Math.floor(data.expectedViews ?? 0)),
				expectedClicks: Math.max(0, Math.floor(data.expectedClicks ?? 0)),
				expectedLeads: Math.max(0, Math.floor(data.expectedLeads ?? 0)),
				notes: data.notes ?? null,
			},
			include: { channels: true },
		})
	}

	async updateTelegramCampaign(id: string, data: any) {
		const patch: any = {}
		for (const k of ['name', 'postText', 'landingUrl', 'notes']) {
			if (data[k] !== undefined) patch[k] = data[k] ?? null
		}
		for (const k of ['budget', 'expectedViews', 'expectedClicks', 'expectedLeads']) {
			if (data[k] !== undefined) patch[k] = Math.max(0, Math.floor(data[k]))
		}
		return this.prisma.telegramAdCampaign.update({ where: { id }, data: patch })
	}

	async deleteTelegramCampaign(id: string) {
		return this.prisma.telegramAdCampaign.delete({ where: { id } })
	}

	async addTelegramChannel(campaignId: string, data: any) {
		return this.prisma.telegramAdChannel.create({
			data: {
				campaignId,
				link: (data.link ?? '').trim(),
				name: data.name?.trim() || null,
				adReturn: data.adReturn != null ? Math.floor(data.adReturn) : null,
				subscribers: data.subscribers != null ? Math.floor(data.subscribers) : null,
				reach24: data.reach24 != null ? Math.floor(data.reach24) : null,
				err24: data.err24 != null ? Math.floor(data.err24) : null,
				postCost: data.postCost != null ? Math.floor(data.postCost) : null,
				isAuthor: !!data.isAuthor,
				shouldBuy: !!data.shouldBuy,
			},
		})
	}

	async updateTelegramChannel(id: string, data: any) {
		const patch: any = {}
		if (data.link !== undefined) patch.link = String(data.link).trim()
		if (data.name !== undefined) patch.name = data.name?.trim() || null
		for (const k of ['adReturn', 'subscribers', 'reach24', 'err24', 'postCost']) {
			if (data[k] !== undefined) patch[k] = data[k] === null ? null : Math.max(0, Math.floor(data[k]))
		}
		if (data.isAuthor !== undefined) patch.isAuthor = !!data.isAuthor
		if (data.shouldBuy !== undefined) patch.shouldBuy = !!data.shouldBuy
		return this.prisma.telegramAdChannel.update({ where: { id }, data: patch })
	}

	async deleteTelegramChannel(id: string) {
		return this.prisma.telegramAdChannel.delete({ where: { id } })
	}

	async getActiveUsersNow() {
		const fiveMinutesAgo = new Date()
		fiveMinutesAgo.setMinutes(fiveMinutesAgo.getMinutes() - 5)

		const activeExecutions = await this.prisma.execution.findMany({
			where: {
				createdAt: { gte: fiveMinutesAgo },
			},
			include: {
				executor: {
					select: {
						id: true,
						email: true,
						city: true,
					},
				},
				task: {
					include: {
						website: true,
					},
				},
			},
			orderBy: { createdAt: 'desc' },
		})

		return activeExecutions
	}

	async getAnalytics(from: Date, to: Date) {
		const [
			totalSearches,
			foundInTop,
			notFound,
			scriptErrors,
			captchaDropped,
			lockTimeout,
			yandexSearches,
			googleSearches,
			captchaTotal,
			captchaResolved,
			pagesSum,
			totalUsers,
			activeUsers,
			withWebsites,
			newUsers,
			totalEarned,
			totalSpent,
			totalPayments,
		] = await Promise.all([
			this.prisma.execution.count({ where: { createdAt: { gte: from, lte: to } } }),
			this.prisma.execution.count({ where: { createdAt: { gte: from, lte: to }, status: 'COMPLETED', foundInTop: true } }),
			this.prisma.execution.count({ where: { createdAt: { gte: from, lte: to }, status: 'COMPLETED', foundInTop: false } }),
			this.prisma.execution.count({ where: { createdAt: { gte: from, lte: to }, status: 'FAILED', failureReason: 'SCRIPT_ERROR' } }),
			this.prisma.execution.count({ where: { createdAt: { gte: from, lte: to }, status: 'FAILED', failureReason: 'CAPTCHA' } }),
			this.prisma.execution.count({ where: { createdAt: { gte: from, lte: to }, status: 'FAILED', failureReason: 'LOCK_TIMEOUT' } }),
			this.prisma.execution.count({ where: { createdAt: { gte: from, lte: to }, yandexFoundInTop: { not: null } } }),
			this.prisma.execution.count({ where: { createdAt: { gte: from, lte: to }, googleFoundInTop: { not: null } } }),
			this.prisma.captchaEvent.count({ where: { createdAt: { gte: from, lte: to } } }),
			this.prisma.captchaEvent.count({ where: { createdAt: { gte: from, lte: to }, resolved: true } }),
			this.prisma.execution.aggregate({ where: { createdAt: { gte: from, lte: to } }, _sum: { pagesVisited: true } }),
			this.prisma.user.count(),
			this.prisma.user.count({ where: { executions: { some: { createdAt: { gte: from, lte: to } } } } }),
			this.prisma.user.count({ where: { websites: { some: {} } } }),
			this.prisma.user.count({ where: { createdAt: { gte: from, lte: to } } }),
			this.prisma.balanceHistory.aggregate({ where: { type: 'TASK_EARNED', createdAt: { gte: from, lte: to } }, _sum: { amount: true } }),
			this.prisma.balanceHistory.aggregate({ where: { type: 'TASK_SPENT', createdAt: { gte: from, lte: to } }, _sum: { amount: true } }),
			this.prisma.balanceHistory.aggregate({ where: { type: 'PAYMENT', createdAt: { gte: from, lte: to } }, _sum: { amount: true } }),
		])

		// По дням — CTE вместо коррелированных подзапросов
		const byDay = await this.prisma.$queryRaw<Array<{
			date: string; found: bigint; not_found: bigint; errors: bigint; new_users: bigint; captchas: bigint; active_nodes: bigint
		}>>`
			WITH exec_dates AS (
				SELECT DISTINCT DATE(e."createdAt") AS date
				FROM executions e
				WHERE e."createdAt" >= ${from} AND e."createdAt" <= ${to}
			),
			exec_stats AS (
				SELECT
					DATE(e."createdAt") AS date,
					COUNT(CASE WHEN e.status = 'COMPLETED' AND e."foundInTop" = true  THEN 1 END) AS found,
					COUNT(CASE WHEN e.status = 'COMPLETED' AND e."foundInTop" = false THEN 1 END) AS not_found,
					COUNT(CASE WHEN e.status = 'FAILED' THEN 1 END) AS errors,
					COUNT(DISTINCT e."executorId") AS active_nodes
				FROM executions e
				WHERE e."createdAt" >= ${from} AND e."createdAt" <= ${to}
				GROUP BY DATE(e."createdAt")
			),
			user_stats AS (
				SELECT DATE(u."createdAt") AS date, COUNT(*) AS new_users
				FROM users u
				WHERE DATE(u."createdAt") IN (SELECT date FROM exec_dates)
				GROUP BY DATE(u."createdAt")
			),
			captcha_stats AS (
				SELECT DATE(c."createdAt") AS date, COUNT(*) AS captchas
				FROM captcha_events c
				WHERE DATE(c."createdAt") IN (SELECT date FROM exec_dates)
				GROUP BY DATE(c."createdAt")
			)
			SELECT
				es.date::text AS date,
				es.found,
				es.not_found,
				es.errors,
				es.active_nodes,
				COALESCE(us.new_users, 0) AS new_users,
				COALESCE(cs.captchas, 0) AS captchas
			FROM exec_stats es
			LEFT JOIN user_stats   us ON us.date = es.date
			LEFT JOIN captcha_stats cs ON cs.date = es.date
			ORDER BY es.date DESC
			LIMIT 30
		`

		// Позиции — улучшились/ухудшились
		const latestPositions = await this.prisma.$queryRaw<Array<{
			taskId: string; yandex_curr: number | null; yandex_prev: number | null;
			google_curr: number | null; google_prev: number | null
		}>>`
			SELECT
				p1."taskId",
				p1."yandexPosition" as yandex_curr, p2."yandexPosition" as yandex_prev,
				p1."googlePosition" as google_curr, p2."googlePosition" as google_prev
			FROM position_history p1
			LEFT JOIN position_history p2 ON p2."taskId" = p1."taskId"
				AND p2."createdAt" = (
					SELECT MAX("createdAt") FROM position_history
					WHERE "taskId" = p1."taskId" AND "createdAt" < p1."createdAt"
				)
			WHERE p1."createdAt" = (
				SELECT MAX("createdAt") FROM position_history WHERE "taskId" = p1."taskId"
			)
		`

		let improved = 0, worsened = 0, unchanged = 0, noData = 0
		for (const row of latestPositions) {
			const yImproved = row.yandex_curr && row.yandex_prev ? row.yandex_prev > row.yandex_curr : null
			const gImproved = row.google_curr && row.google_prev ? row.google_prev > row.google_curr : null
			if (yImproved === null && gImproved === null) { noData++; continue }
			const improved_ = (yImproved === true) || (gImproved === true)
			const worsened_ = (yImproved === false) || (gImproved === false)
			if (improved_) improved++
			else if (worsened_) worsened++
			else unchanged++
		}

		// Сайты в топ-10
		const sitesInTop10 = latestPositions.filter(
			r => (r.yandex_curr && r.yandex_curr <= 10) || (r.google_curr && r.google_curr <= 10)
		).length

		return {
			searches: {
				total: totalSearches,
				foundInTop,
				notFound,
				scriptErrors,
				captchaDropped,
				lockTimeout,
				byEngine: {
					yandex: { total: yandexSearches },
					google: { total: googleSearches },
				},
				byDay: byDay.map(r => ({
					date: r.date,
					found: Number(r.found),
					notFound: Number(r.not_found),
					errors: Number(r.errors),
				})),
			},
			captcha: {
				total: captchaTotal,
				resolved: captchaResolved,
				dropped: captchaTotal - captchaResolved,
				byDay: byDay.map(r => ({ date: r.date, count: Number(r.captchas) })),
			},
			pages: {
				totalVisited: pagesSum._sum.pagesVisited ?? 0,
				avgPerTask: totalSearches > 0 ? Math.round((pagesSum._sum.pagesVisited ?? 0) / totalSearches) : 0,
			},
			positions: { improved, worsened, unchanged, noData, sitesInTop10 },
			users: {
				total: totalUsers,
				activeThisPeriod: activeUsers,
				withWebsites,
				newThisPeriod: newUsers,
				byDay: byDay.map(r => ({ date: r.date, newRegistrations: Number(r.new_users) })),
			},
			nodes: {
				byDay: byDay.map(r => ({ date: r.date, nodes: Number(r.active_nodes) })),
			},
			economy: {
				totalEarned: totalEarned._sum.amount ?? 0,
				totalSpent: Math.abs(totalSpent._sum.amount ?? 0),
				totalPaymentPoints: totalPayments._sum.amount ?? 0,
			},
		}
	}

	// Кто удалил приложение (appStatus = UNINSTALLED) + сколько был «в сети».
	// Длительность онлайна = от регистрации до последнего app-сигнала
	// (heartbeat / app-логин / последнее выполненное задание).
	async getDeletedUsers() {
		const [rows, capacity] = await Promise.all([
			this.prisma.$queryRaw<Array<{
				id: string
				email: string
				balance: number
				promoCode: string | null
				city: string | null
				appVersion: string | null
				createdAt: Date
				lastSeenAt: Date | null
				appLastLoginAt: Date | null
				lastExecution: Date | null
				websites: string | null
			}>>`
				SELECT u.id, u.email, u.balance, u."promoCode", u.city, u."appVersion",
				       u."createdAt", u."lastSeenAt", u."appLastLoginAt",
				       MAX(e."completedAt") FILTER (WHERE e.status = 'COMPLETED') AS "lastExecution",
				       STRING_AGG(DISTINCT w.url, ', ') FILTER (WHERE w.url IS NOT NULL) AS websites
				FROM users u
				LEFT JOIN executions e ON e."executorId" = u.id
				LEFT JOIN websites w ON w."userId" = u.id
				WHERE u."appStatus" = 'UNINSTALLED'
				GROUP BY u.id
				ORDER BY GREATEST(
					u."lastSeenAt",
					u."appLastLoginAt",
					MAX(e."completedAt") FILTER (WHERE e.status = 'COMPLETED')
				) DESC NULLS LAST
				LIMIT 500
			`,
			this.appConfig.getNetworkCapacityInfo(),
		])
		const day = 86400000
		const users = rows.map(u => {
			const signals = [u.lastSeenAt, u.appLastLoginAt, u.lastExecution]
				.filter(Boolean)
				.map(d => new Date(d as Date).getTime())
			const lastSignal = signals.length ? Math.max(...signals) : null
			const onlineDays = lastSignal
				? Math.max(0, Math.round((lastSignal - new Date(u.createdAt).getTime()) / day))
				: 0
			return {
				...u,
				websites: u.websites ? u.websites.split(', ').filter(Boolean) : [],
				lastSignal: lastSignal ? new Date(lastSignal).toISOString() : null,
				onlineDays,
			}
		})
		const networkTasksPerDay = capacity.avgPerDay * capacity.maxPerDay
		return { total: users.length, users, networkTasksPerDay }
	}

	// Журнал задач: последние выполнения со всей сети — и найденные (зелёным),
	// и не найденные / упавшие. Для найденных видно, в какой системе нашли
	// (yandexFoundInTop / googleFoundInTop) и позицию. failureReason — код
	// причины (CAPTCHA / SCRIPT_ERROR / NOT_IN_SERP / LOCK_TIMEOUT).
	async getExecutionLog(limit = 300) {
		return this.prisma.execution.findMany({
			where: { status: { in: ['COMPLETED', 'FAILED'] } },
			select: {
				id: true,
				status: true,
				foundInTop: true,
				yandexFoundInTop: true,
				googleFoundInTop: true,
				position: true,
				failureReason: true,
				completionKind: true,
				createdAt: true,
				completedAt: true,
				task: { select: { keyword: true, website: { select: { url: true } } } },
				executor: { select: { id: true, email: true, appVersion: true } },
			},
			orderBy: { createdAt: 'desc' },
			take: limit,
		})
	}

	// Письмо «вернись» — только по ручному нажатию админа. Текст редактируется на фронте,
	// сюда приходит готовый subject + message (обычный текст), бэкенд оборачивает в бренд-шаблон.
	async sendWinbackEmail(userId: string, subject: string, message: string) {
		const user = await this.prisma.user.findUnique({
			where: { id: userId },
			select: { email: true },
		})
		if (!user) throw new Error('Пользователь не найден')
		await this.notifications.sendWinbackEmail(user.email, subject, message)
		return { sent: true, email: user.email }
	}

	async deleteUser(userId: string) {
		return this.prisma.user.delete({ where: { id: userId } })
	}

	async deleteWebsite(websiteId: string) {
		return this.prisma.website.delete({ where: { id: websiteId } })
	}

	async deleteAdminTask(taskId: string) {
		return this.prisma.task.delete({ where: { id: taskId } })
	}

	async getSiteStats(page = 0, limit = 30) {
		const offset = page * limit

		// Сайты, поднявшиеся хотя бы на 1 позицию (сравниваем два последних position_history)
		const rising = await this.prisma.$queryRaw<Array<{
			task_id: string; url: string; keyword: string; user_email: string
			yandex_curr: number | null; yandex_prev: number | null
			google_curr: number | null; google_prev: number | null
			improvement: number
		}>>`
			WITH ranked AS (
				SELECT
					ph."taskId",
					ph."yandexPosition",
					ph."googlePosition",
					ROW_NUMBER() OVER (PARTITION BY ph."taskId" ORDER BY ph."createdAt" DESC) AS rn
				FROM position_history ph
			)
			SELECT
				curr."taskId" AS task_id,
				w.url,
				t.keyword,
				u.email AS user_email,
				curr."yandexPosition"   AS yandex_curr,
				prev."yandexPosition"   AS yandex_prev,
				curr."googlePosition"   AS google_curr,
				prev."googlePosition"   AS google_prev,
				GREATEST(
					COALESCE(prev."yandexPosition" - curr."yandexPosition", 0),
					COALESCE(prev."googlePosition" - curr."googlePosition", 0)
				) AS improvement
			FROM ranked curr
			JOIN ranked prev ON prev."taskId" = curr."taskId" AND prev.rn = 2
			JOIN tasks    t  ON t.id = curr."taskId"
			JOIN websites w  ON w.id = t."websiteId"
			JOIN users    u  ON u.id = w."userId"
			WHERE curr.rn = 1
				AND (
					(curr."yandexPosition" IS NOT NULL AND prev."yandexPosition" IS NOT NULL AND curr."yandexPosition" < prev."yandexPosition")
					OR
					(curr."googlePosition" IS NOT NULL AND prev."googlePosition" IS NOT NULL AND curr."googlePosition" < prev."googlePosition")
				)
			ORDER BY improvement DESC
			LIMIT ${limit} OFFSET ${offset}
		`

		const risingTotal = await this.prisma.$queryRaw<[{ cnt: bigint }]>`
			WITH ranked AS (
				SELECT
					ph."taskId",
					ph."yandexPosition",
					ph."googlePosition",
					ROW_NUMBER() OVER (PARTITION BY ph."taskId" ORDER BY ph."createdAt" DESC) AS rn
				FROM position_history ph
			)
			SELECT COUNT(*) AS cnt
			FROM ranked curr
			JOIN ranked prev ON prev."taskId" = curr."taskId" AND prev.rn = 2
			WHERE curr.rn = 1
				AND (
					(curr."yandexPosition" IS NOT NULL AND prev."yandexPosition" IS NOT NULL AND curr."yandexPosition" < prev."yandexPosition")
					OR
					(curr."googlePosition" IS NOT NULL AND prev."googlePosition" IS NOT NULL AND curr."googlePosition" < prev."googlePosition")
				)
		`

		// Сайты, которые пропали: были найдены раньше, но последние 10 выполнений — "не найден"
		const disappeared = await this.prisma.$queryRaw<Array<{
			url: string; keyword: string; user_email: string; last_found_at: Date; consecutive_not_found: bigint
		}>>`
			WITH latest_completed AS (
				SELECT
					e."taskId",
					e."foundInTop",
					ROW_NUMBER() OVER (PARTITION BY e."taskId" ORDER BY e."completedAt" DESC) AS rn
				FROM executions e
				WHERE e.status = 'COMPLETED'
			),
			bad_tasks AS (
				SELECT "taskId"
				FROM latest_completed
				WHERE rn <= 10
				GROUP BY "taskId"
				HAVING COUNT(*) >= 10
					AND SUM(CASE WHEN "foundInTop" = true THEN 1 ELSE 0 END) = 0
			),
			last_found AS (
				SELECT e."taskId", MAX(e."completedAt") AS last_found_at
				FROM executions e
				WHERE e."foundInTop" = true AND e."taskId" IN (SELECT "taskId" FROM bad_tasks)
				GROUP BY e."taskId"
			)
			SELECT
				w.url,
				t.keyword,
				u.email AS user_email,
				lf.last_found_at,
				(
					SELECT COUNT(*)
					FROM executions e2
					WHERE e2."taskId" = t.id
						AND e2.status = 'COMPLETED'
						AND e2."completedAt" > lf.last_found_at
				) AS consecutive_not_found
			FROM bad_tasks bt
			JOIN last_found lf ON lf."taskId" = bt."taskId"
			JOIN tasks    t   ON t.id = bt."taskId"
			JOIN websites w   ON w.id = t."websiteId"
			JOIN users    u   ON u.id = w."userId"
			ORDER BY lf.last_found_at ASC
		`

		return {
			rising: rising.map(r => ({
				taskId: r.task_id,
				url: r.url,
				keyword: r.keyword,
				userEmail: r.user_email,
				yandexCurr: r.yandex_curr,
				yandexPrev: r.yandex_prev,
				googleCurr: r.google_curr,
				googlePrev: r.google_prev,
				improvement: Number(r.improvement),
			})),
			risingTotal: Number(risingTotal[0]?.cnt ?? 0),
			disappeared: disappeared.map(r => ({
				url: r.url,
				keyword: r.keyword,
				userEmail: r.user_email,
				lastFoundAt: r.last_found_at,
				consecutiveNotFound: Number(r.consecutive_not_found),
			})),
		}
	}

	async getSiteTrend(taskId: string) {
		// Находим websiteId через taskId
		const task = await this.prisma.task.findUnique({
			where: { id: taskId },
			select: { websiteId: true },
		})
		if (!task) return { meta: null, keywords: [] }

		const metaRows = await this.prisma.$queryRaw<Array<{
			url: string; user_email: string; user_id: string
		}>>`
			SELECT w.url, u.email AS user_email, u.id AS user_id
			FROM websites w
			JOIN users u ON u.id = w."userId"
			WHERE w.id = ${task.websiteId}
			LIMIT 1
		`

		// История позиций по всем ключевикам сайта; 101 = не найден, исключаем
		const rows = await this.prisma.$queryRaw<Array<{
			task_id: string; keyword: string; date: Date
			yandex_pos: number | null; google_pos: number | null
		}>>`
			SELECT
				t.id AS task_id,
				t.keyword,
				DATE(ph."createdAt") AS date,
				MIN(CASE WHEN ph."yandexPosition" < 101 THEN ph."yandexPosition" END) AS yandex_pos,
				MIN(CASE WHEN ph."googlePosition" < 101 THEN ph."googlePosition" END) AS google_pos
			FROM tasks t
			JOIN position_history ph ON ph."taskId" = t.id
			WHERE t."websiteId" = ${task.websiteId}
			GROUP BY t.id, t.keyword, DATE(ph."createdAt")
			ORDER BY t.keyword ASC, date ASC
		`

		// Группируем по задаче
		const grouped = new Map<string, { keyword: string; history: Array<{ date: string; yandex: number | null; google: number | null }> }>()
		for (const row of rows) {
			if (!grouped.has(row.task_id)) grouped.set(row.task_id, { keyword: row.keyword, history: [] })
			const dateStr = row.date instanceof Date ? row.date.toISOString().slice(0, 10) : String(row.date).slice(0, 10)
			grouped.get(row.task_id)!.history.push({
				date: dateStr,
				yandex: row.yandex_pos != null ? Number(row.yandex_pos) : null,
				google: row.google_pos != null ? Number(row.google_pos) : null,
			})
		}

		return {
			meta: metaRows[0] ?? null,
			keywords: Array.from(grouped.entries()).map(([kTaskId, { keyword, history }]) => {
				const firstY = history.find(h => h.yandex != null)?.yandex ?? null
				const lastY = [...history].reverse().find(h => h.yandex != null)?.yandex ?? null
				const firstG = history.find(h => h.google != null)?.google ?? null
				const lastG = [...history].reverse().find(h => h.google != null)?.google ?? null
				return {
					taskId: kTaskId,
					keyword,
					history,
					firstYandex: firstY,
					lastYandex: lastY,
					yandexDelta: firstY != null && lastY != null ? firstY - lastY : null,
					firstGoogle: firstG,
					lastGoogle: lastG,
					googleDelta: firstG != null && lastG != null ? firstG - lastG : null,
				}
			}),
		}
	}
}
