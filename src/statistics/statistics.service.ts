import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class StatisticsService {
	constructor(private prisma: PrismaService) {}

	async getWebsiteStatistics(websiteId: string, userId: string) {
		// Проверка доступа
		const website = await this.prisma.website.findUnique({
			where: { id: websiteId },
		})

		if (!website || website.userId !== userId) {
			throw new Error('Access denied')
		}

		// Получаем статистику по ключевым словам
		const stats = await this.prisma.statistic.findMany({
			where: { websiteId },
			orderBy: { date: 'desc' },
			take: 100,
		})

		return stats
	}

	async updateStatistics(
		websiteId: string,
		keyword: string,
		position: number | null,
	) {
		const today = new Date()
		today.setHours(0, 0, 0, 0)

		// Определяем категорию позиции
		const positionData = this.categorizePosition(position)

		// Обновляем или создаем статистику
		const stat = await this.prisma.statistic.upsert({
			where: {
				websiteId_keyword_date: {
					websiteId,
					keyword,
					date: today,
				},
			},
			update: {
				position,
				...positionData,
				totalVisits: { increment: 1 },
			},
			create: {
				websiteId,
				keyword,
				position,
				...positionData,
				totalVisits: 1,
				date: today,
			},
		})

		return stat
	}

	async getAdminStatistics() {
		const [totalUsers, activeUsers, totalTasks, completedTasks, totalBalance] =
			await Promise.all([
				this.prisma.user.count(),
				this.prisma.user.count({ where: { isActive: true } }),
				this.prisma.task.count(),
				this.prisma.task.count({ where: { status: 'COMPLETED' } }),
				this.prisma.user.aggregate({ _sum: { balance: true } }),
			])

		// Активные пользователи за последние 24 часа
		const yesterday = new Date()
		yesterday.setDate(yesterday.getDate() - 1)

		const activeUsersLast24h = await this.prisma.execution.groupBy({
			by: ['executorId'],
			where: {
				createdAt: { gte: yesterday },
			},
		})

		return {
			totalUsers,
			activeUsers,
			activeUsersLast24h: activeUsersLast24h.length,
			totalTasks,
			completedTasks,
			totalBalance: totalBalance._sum.balance || 0,
		}
	}

	async getUserStatistics(userId: string) {
		const now = new Date()
		const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)

		// Получаем статистику из executions (выполненные задачи)
			const [
				yandexCompleted24h,
				googleCompleted24h,
				yandexCompletedTotal,
				googleCompletedTotal,
				yandexReceived24h,
				googleReceived24h,
				yandexReceivedTotal,
				googleReceivedTotal,
				yandexVisits24h,
				googleVisits24h,
				yandexVisitsTotal,
				googleVisitsTotal,
			] = await Promise.all([
				// Поиски выполнил за 24 часа — считаем каждый движок отдельно
				this.prisma.execution.count({
					where: {
						executorId: userId,
						status: 'COMPLETED',
						yandexFoundInTop: { not: null },
						createdAt: { gte: oneDayAgo },
					},
				}),
				this.prisma.execution.count({
					where: {
						executorId: userId,
						status: 'COMPLETED',
						googleFoundInTop: { not: null },
						createdAt: { gte: oneDayAgo },
					},
				}),
				// Поиски выполнил всего
				this.prisma.execution.count({
					where: {
						executorId: userId,
						status: 'COMPLETED',
						yandexFoundInTop: { not: null },
					},
				}),
				this.prisma.execution.count({
					where: {
						executorId: userId,
						status: 'COMPLETED',
						googleFoundInTop: { not: null },
					},
				}),
				// Поиски получил за 24 часа (через задачи пользователя)
				this.prisma.execution.count({
					where: {
						task: {
							website: {
								userId: userId,
							},
						},
						status: 'COMPLETED',
						yandexFoundInTop: { not: null },
						createdAt: { gte: oneDayAgo },
					},
				}),
				this.prisma.execution.count({
					where: {
						task: {
							website: {
								userId: userId,
							},
						},
						status: 'COMPLETED',
						googleFoundInTop: { not: null },
						createdAt: { gte: oneDayAgo },
					},
				}),
				// Поиски получил всего
				this.prisma.execution.count({
					where: {
						task: {
							website: {
								userId: userId,
							},
						},
						status: 'COMPLETED',
						yandexFoundInTop: { not: null },
					},
				}),
				this.prisma.execution.count({
					where: {
						task: {
							website: {
								userId: userId,
							},
						},
						status: 'COMPLETED',
						googleFoundInTop: { not: null },
					},
				}),
				// Посещения получил за 24 часа (считаем как задачи с найденными сайтами)
				this.prisma.execution.count({
					where: {
					task: {
						website: {
							userId: userId,
						},
						},
						status: 'COMPLETED',
						yandexFoundInTop: true,
						createdAt: { gte: oneDayAgo },
					},
				}),
				this.prisma.execution.count({
					where: {
						task: {
							website: {
								userId: userId,
							},
						},
						status: 'COMPLETED',
						googleFoundInTop: true,
						createdAt: { gte: oneDayAgo },
					},
				}),
				// Посещения получил всего
				this.prisma.execution.count({
					where: {
						task: {
							website: {
								userId: userId,
							},
						},
						status: 'COMPLETED',
						yandexFoundInTop: true,
					},
				}),
				this.prisma.execution.count({
					where: {
						task: {
							website: {
								userId: userId,
							},
						},
						status: 'COMPLETED',
						googleFoundInTop: true,
					},
				}),
			])

			return {
				searchesCompleted24h: yandexCompleted24h + googleCompleted24h,
				searchesReceived24h: yandexReceived24h + googleReceived24h,
				visitsCompleted24h: yandexVisits24h + googleVisits24h,
				searchesCompletedTotal: yandexCompletedTotal + googleCompletedTotal,
				searchesReceivedTotal: yandexReceivedTotal + googleReceivedTotal,
				visitsCompletedTotal: yandexVisitsTotal + googleVisitsTotal,
			}
		}

	async getWebsiteSeoStats(websiteId: string, userId: string) {
		const website = await this.prisma.website.findUnique({
			where: { id: websiteId },
			include: { tasks: true },
		})

		if (!website || website.userId !== userId) {
			throw new Error('Access denied')
		}

		const now = new Date()
		const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
		const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)

		// Последние позиции по каждому ключевому слову (из PositionHistory)
		const tasks = website.tasks
		const keywordStats: Array<{
			keyword: string
			taskId: string
			currentYandex: number | null
			currentGoogle: number | null
			prevYandex: number | null
			prevGoogle: number | null
			yandexDelta: number | null
			googleDelta: number | null
			totalVisits: number
			yandexVisits: number
			googleVisits: number
		}> = []

		for (const task of tasks) {
			if (!task.keyword) continue

			// Последние позиции за 7 дней — отдельно для Яндекса и Google
			const [recentY, recentG, prevY, prevG, statAgg] = await Promise.all([
				this.prisma.positionHistory.findFirst({
					where: { taskId: task.id, date: { gte: sevenDaysAgo }, yandexPosition: { not: null } },
					orderBy: { date: 'desc' },
				}),
				this.prisma.positionHistory.findFirst({
					where: { taskId: task.id, date: { gte: sevenDaysAgo }, googlePosition: { not: null } },
					orderBy: { date: 'desc' },
				}),
				this.prisma.positionHistory.findFirst({
					where: { taskId: task.id, date: { gte: fourteenDaysAgo, lt: sevenDaysAgo }, yandexPosition: { not: null } },
					orderBy: { date: 'desc' },
				}),
				this.prisma.positionHistory.findFirst({
					where: { taskId: task.id, date: { gte: fourteenDaysAgo, lt: sevenDaysAgo }, googlePosition: { not: null } },
					orderBy: { date: 'desc' },
				}),
				this.prisma.statistic.aggregate({
					where: { websiteId, keyword: task.keyword },
					_sum: { totalVisits: true, yandexVisits: true, googleVisits: true },
				}),
			])

			const currentYandex = recentY?.yandexPosition ?? null
			const currentGoogle = recentG?.googlePosition ?? null
			const prevYandex = prevY?.yandexPosition ?? null
			const prevGoogle = prevG?.googlePosition ?? null

			keywordStats.push({
				keyword: task.keyword,
				taskId: task.id,
				currentYandex,
				currentGoogle,
				prevYandex,
				prevGoogle,
				// Дельта: отрицательная = улучшение (позиция стала ниже по числу = выше в выдаче)
				yandexDelta: currentYandex !== null && prevYandex !== null ? prevYandex - currentYandex : null,
				googleDelta: currentGoogle !== null && prevGoogle !== null ? prevGoogle - currentGoogle : null,
				totalVisits: statAgg._sum.totalVisits ?? 0,
				yandexVisits: statAgg._sum.yandexVisits ?? 0,
				googleVisits: statAgg._sum.googleVisits ?? 0,
			})
		}

		// Агрегаты для Яндекса
		const yPositions = keywordStats.map(k => k.currentYandex).filter((v): v is number => v !== null)
		const gPositions = keywordStats.map(k => k.currentGoogle).filter((v): v is number => v !== null)

		const yAvg = yPositions.length ? Math.round(yPositions.reduce((a, b) => a + b, 0) / yPositions.length) : null
		const gAvg = gPositions.length ? Math.round(gPositions.reduce((a, b) => a + b, 0) / gPositions.length) : null

		// Видимость = % ключевых слов в топ-10 (из тех что проверялись)
		const totalChecked = Math.max(yPositions.length, gPositions.length, 1)
		const inTop10Y = yPositions.filter(v => v <= 10).length
		const inTop10G = gPositions.filter(v => v <= 10).length
		const visibilityScore = Math.round(((inTop10Y + inTop10G) / (totalChecked * 2)) * 100)

		// Топ растущих и падающих ключевых слов
		const improving = [...keywordStats]
			.filter(k => k.yandexDelta !== null && k.yandexDelta > 0)
			.sort((a, b) => (b.yandexDelta ?? 0) - (a.yandexDelta ?? 0))
			.slice(0, 3)

		const declining = [...keywordStats]
			.filter(k => k.yandexDelta !== null && k.yandexDelta < 0)
			.sort((a, b) => (a.yandexDelta ?? 0) - (b.yandexDelta ?? 0))
			.slice(0, 3)

		// Распределение по позициям
		const distribution = {
			yandex: {
				top3: yPositions.filter(v => v <= 3).length,
				top10: yPositions.filter(v => v > 3 && v <= 10).length,
				top30: yPositions.filter(v => v > 10 && v <= 30).length,
				top100: yPositions.filter(v => v > 30 && v <= 100).length,
				// null = не найдено в топ-50 (глубже не сканируем)
				outTop: keywordStats.filter(k => k.currentYandex === null && tasks.find(t => t.keyword === k.keyword)?.useYandex).length,
			},
			google: {
				top3: gPositions.filter(v => v <= 3).length,
				top10: gPositions.filter(v => v > 3 && v <= 10).length,
				top30: gPositions.filter(v => v > 10 && v <= 30).length,
				top100: gPositions.filter(v => v > 30 && v <= 100).length,
				// null = не найдено в топ-50 (глубже не сканируем)
				outTop: keywordStats.filter(k => k.currentGoogle === null && tasks.find(t => t.keyword === k.keyword)?.useGoogle).length,
			},
		}

		// Общие визиты за последние 30 дней
		const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
		const recentVisits = await this.prisma.execution.count({
			where: {
				task: { websiteId },
				status: 'COMPLETED',
				foundInTop: true,
				createdAt: { gte: thirtyDaysAgo },
			},
		})

		// Визиты за предыдущие 30 дней (30-60 дней назад)
		const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000)
		const prevVisits = await this.prisma.execution.count({
			where: {
				task: { websiteId },
				status: 'COMPLETED',
				foundInTop: true,
				createdAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo },
			},
		})

		return {
			keywords: keywordStats,
			summary: {
				totalKeywords: tasks.filter(t => t.keyword).length,
				checkedKeywords: Math.max(yPositions.length, gPositions.length),
				yandexAvgPosition: yAvg,
				googleAvgPosition: gAvg,
				visibilityScore,
				visitsLast30Days: recentVisits,
				visitsTrend: prevVisits > 0 ? Math.round(((recentVisits - prevVisits) / prevVisits) * 100) : null,
			},
			distribution,
			improving,
			declining,
		}
	}

	private categorizePosition(position: number | null) {
		if (!position) {
			return {
				inTop1: 0,
				inTop2_3: 0,
				inTop5: 0,
				inTop10: 0,
				inTop50: 0,
				belowTop50: 1,
			}
		}

		return {
			inTop1: position === 1 ? 1 : 0,
			inTop2_3: position >= 2 && position <= 3 ? 1 : 0,
			inTop5: position >= 4 && position <= 5 ? 1 : 0,
			inTop10: position >= 6 && position <= 10 ? 1 : 0,
			inTop50: position >= 11 && position <= 50 ? 1 : 0,
			belowTop50: 0,
		}
	}
}
