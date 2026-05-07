import { Injectable, OnModuleInit } from '@nestjs/common'
import { NotificationsService } from '../notifications/notifications.service'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class TaskSchedulerService implements OnModuleInit {
	constructor(
		private prisma: PrismaService,
		private notifications: NotificationsService,
	) {}

	onModuleInit() {
		setTimeout(() => this.resetStuckTasks(), 10000)
		setInterval(() => this.resetStuckTasks(), 15 * 60 * 1000)

		// Детектор мёртвых execution (зависли IN_PROGRESS > 30 мин)
		setTimeout(() => this.resetStuckExecutions(), 15000)
		setInterval(() => this.resetStuckExecutions(), 10 * 60 * 1000)

		// Еженедельный отчёт — каждый понедельник в 09:00
		this.scheduleWeeklyReports()
	}

	private async resetStuckTasks() {
		const cutoff = new Date(Date.now() - 15 * 60 * 1000)
		try {
			const result = await this.prisma.task.updateMany({
				where: {
					status: { in: ['ASSIGNED', 'IN_PROGRESS'] },
					isActive: true,
					updatedAt: { lt: cutoff },
				},
				data: { status: 'PENDING' },
			})
			if (result.count > 0) {
				console.log(`[TaskScheduler] Сброшено ${result.count} зависших задач в PENDING`)
			}
		} catch (error) {
			console.error('[TaskScheduler] Ошибка сброса задач:', error)
		}
	}

	private async resetStuckExecutions() {
		const cutoff = new Date(Date.now() - 30 * 60 * 1000)
		try {
			// Находим зависшие execution
			const stuck = await this.prisma.execution.findMany({
				where: {
					status: 'IN_PROGRESS',
					createdAt: { lt: cutoff },
				},
				select: { id: true, taskId: true },
			})

			if (stuck.length === 0) return

			const ids = stuck.map(e => e.id)
			const taskIds = [...new Set(stuck.map(e => e.taskId))]

			// Помечаем как FAILED
			await this.prisma.execution.updateMany({
				where: { id: { in: ids } },
				data: {
					status: 'FAILED',
					failureReason: 'LOCK_TIMEOUT',
					completedAt: new Date(),
				},
			})

			// Возвращаем задачи в PENDING (retry)
			await this.prisma.task.updateMany({
				where: { id: { in: taskIds }, status: 'IN_PROGRESS' },
				data: { status: 'PENDING' },
			})

			console.log(`[TaskScheduler] Сброшено ${stuck.length} зависших execution, ${taskIds.length} задач → PENDING`)
		} catch (error) {
			console.error('[TaskScheduler] Ошибка сброса execution:', error)
		}
	}

	private scheduleWeeklyReports() {
		const checkAndSend = async () => {
			const now = new Date()
			// Понедельник = 1, 09:00
			if (now.getDay() === 1 && now.getHours() === 9 && now.getMinutes() < 10) {
				await this.sendWeeklyReports()
			}
		}
		// Проверяем каждые 10 минут
		setInterval(checkAndSend, 10 * 60 * 1000)
	}

	async sendWeeklyReports() {
		console.log('[TaskScheduler] Отправка еженедельных отчётов...')
		try {
			const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

			const users = await this.prisma.user.findMany({
				where: { weeklyReportEnabled: true, emailVerified: true },
				select: {
					id: true,
					email: true,
					balance: true,
					websites: {
						where: { isActive: true },
						select: {
							name: true,
							url: true,
							tasks: {
								where: { isActive: true },
								select: {
									keyword: true,
									positionHistory: {
										orderBy: { createdAt: 'desc' },
										take: 2,
										select: { yandexPosition: true, googlePosition: true, createdAt: true },
									},
								},
							},
						},
					},
					executions: {
						where: { createdAt: { gte: weekAgo }, status: 'COMPLETED' },
						select: { pointsEarned: true, foundInTop: true },
					},
				},
			})

			let sent = 0
			for (const user of users) {
				try {
					const weeklyEarned = user.executions.reduce((s, e) => s + e.pointsEarned, 0)
					const tasksCompleted = user.executions.length
					const found = user.executions.filter(e => e.foundInTop).length

					await this.notifications.sendWeeklyReport(user.email, {
						balance: user.balance,
						weeklyEarned,
						tasksCompleted,
						found,
						websites: user.websites,
					})
					sent++
				} catch (e) {
					console.error(`[TaskScheduler] Ошибка отчёта для ${user.email}:`, e)
				}
			}
			console.log(`[TaskScheduler] Отправлено ${sent}/${users.length} отчётов`)
		} catch (error) {
			console.error('[TaskScheduler] Ошибка отправки отчётов:', error)
		}
	}
}
