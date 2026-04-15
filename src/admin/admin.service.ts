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
}
