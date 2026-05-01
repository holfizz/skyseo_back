import { Injectable, OnModuleInit } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class TaskSchedulerService implements OnModuleInit {
	constructor(private prisma: PrismaService) {}

	onModuleInit() {
		setTimeout(() => this.resetStuckTasks(), 10000)
		setInterval(() => this.resetStuckTasks(), 30 * 60 * 1000)
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
}
