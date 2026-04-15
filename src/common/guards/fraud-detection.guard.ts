import {
	CanActivate,
	ExecutionContext,
	ForbiddenException,
	Injectable,
} from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'

@Injectable()
export class FraudDetectionGuard implements CanActivate {
	constructor(private prisma: PrismaService) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const request = context.switchToHttp().getRequest()
		const userId = request.user?.id

		if (!userId) {
			return true // Пропускаем неавторизованных
		}

		// Проверка 1: Слишком много задач за короткое время
		const recentTasks = await this.prisma.task.count({
			where: {
				website: { userId },
				createdAt: {
					gte: new Date(Date.now() - 5 * 60 * 1000), // За последние 5 минут
				},
			},
		})

		if (recentTasks > 50) {
			throw new ForbiddenException(
				'Suspicious activity detected: too many tasks',
			)
		}

		// Проверка 2: Слишком много выполнений за короткое время
		const recentExecutions = await this.prisma.execution.count({
			where: {
				executorId: userId,
				createdAt: {
					gte: new Date(Date.now() - 5 * 60 * 1000),
				},
			},
		})

		if (recentExecutions > 100) {
			throw new ForbiddenException(
				'Suspicious activity detected: too many executions',
			)
		}

		// Проверка 3: Подозрительно быстрое выполнение задач
		const fastExecutions = await this.prisma.execution.count({
			where: {
				executorId: userId,
				duration: { lt: 10 }, // Меньше 10 секунд
				createdAt: {
					gte: new Date(Date.now() - 60 * 60 * 1000), // За последний час
				},
			},
		})

		if (fastExecutions > 20) {
			throw new ForbiddenException(
				'Suspicious activity detected: executions too fast',
			)
		}

		return true
	}
}
