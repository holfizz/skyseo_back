import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { UsersService } from '../users/users.service'

@Injectable()
export class AdminService {
	constructor(
		private prisma: PrismaService,
		private usersService: UsersService,
	) {}

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

		return {
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

	async getAllUsers(limit = 100) {
		return this.prisma.user.findMany({
			select: {
				id: true,
				email: true,
				balance: true,
				role: true,
				city: true,
				referralSource: true,
				isActive: true,
				createdAt: true,
				_count: {
					select: {
						websites: true,
						executions: true,
						payments: true,
					},
				},
			},
			orderBy: { createdAt: 'desc' },
			take: limit,
		})
	}

	async getUserDetails(userId: string) {
		return this.prisma.user.findUnique({
			where: { id: userId },
			include: {
				websites: true,
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
		})
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

		// По дням
		const byDay = await this.prisma.$queryRaw<Array<{
			date: string; found: bigint; not_found: bigint; errors: bigint; new_users: bigint; captchas: bigint
		}>>`
			SELECT
				DATE(e."createdAt") as date,
				COUNT(CASE WHEN e.status = 'COMPLETED' AND e."foundInTop" = true THEN 1 END) as found,
				COUNT(CASE WHEN e.status = 'COMPLETED' AND e."foundInTop" = false THEN 1 END) as not_found,
				COUNT(CASE WHEN e.status = 'FAILED' THEN 1 END) as errors,
				(SELECT COUNT(*) FROM users u WHERE DATE(u."createdAt") = DATE(e."createdAt")) as new_users,
				(SELECT COUNT(*) FROM captcha_events c WHERE DATE(c."createdAt") = DATE(e."createdAt")) as captchas
			FROM executions e
			WHERE e."createdAt" >= ${from} AND e."createdAt" <= ${to}
			GROUP BY DATE(e."createdAt")
			ORDER BY date DESC
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
			economy: {
				totalEarned: totalEarned._sum.amount ?? 0,
				totalSpent: Math.abs(totalSpent._sum.amount ?? 0),
				totalPaymentPoints: totalPayments._sum.amount ?? 0,
			},
		}
	}
}
