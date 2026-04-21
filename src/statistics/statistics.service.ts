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
			searchesCompleted24h,
			searchesCompletedTotal,
			searchesReceived24h,
			searchesReceivedTotal,
			visitsCompleted24h,
			visitsCompletedTotal,
		] = await Promise.all([
			// Поиски выполнил за 24 часа
			this.prisma.execution.count({
				where: {
					executorId: userId,
					status: 'COMPLETED',
					createdAt: { gte: oneDayAgo },
				},
			}),
			// Поиски выполнил всего
			this.prisma.execution.count({
				where: {
					executorId: userId,
					status: 'COMPLETED',
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
					foundInTop: true,
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
					foundInTop: true,
				},
			}),
		])

		return {
			searchesCompleted24h,
			searchesReceived24h,
			visitsCompleted24h,
			searchesCompletedTotal,
			searchesReceivedTotal,
			visitsCompletedTotal,
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
