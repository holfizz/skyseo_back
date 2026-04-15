import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { UsersService } from '../users/users.service'
import { CompleteExecutionDto } from './dto'

@Injectable()
export class ExecutionsService {
	constructor(
		private prisma: PrismaService,
		private usersService: UsersService,
	) {}

	async startExecution(
		taskId: string,
		executorId: string,
		ipAddress?: string,
		userAgent?: string,
	) {
		const task = await this.prisma.task.findUnique({
			where: { id: taskId },
			include: { website: true },
		})

		if (!task || task.status !== 'ASSIGNED') {
			throw new Error('Task not available')
		}

		const execution = await this.prisma.execution.create({
			data: {
				taskId,
				executorId,
				ipAddress,
				userAgent,
			},
		})

		await this.prisma.task.update({
			where: { id: taskId },
			data: { status: 'IN_PROGRESS' },
		})

		return execution
	}

	async completeExecution(executionId: string, dto: CompleteExecutionDto) {
		const execution = await this.prisma.execution.findUnique({
			where: { id: executionId },
			include: {
				task: {
					include: {
						website: {
							include: { user: true },
						},
					},
				},
			},
		})

		if (!execution) {
			throw new Error('Execution not found')
		}

		// ЗАЩИТА: Проверка минимальной длительности
		if (dto.duration < 30) {
			throw new Error('Execution duration too short (minimum 30 seconds)')
		}

		// ЗАЩИТА: Проверка максимальной длительности
		if (dto.duration > 600) {
			throw new Error('Execution duration too long (maximum 10 minutes)')
		}

		// ЗАЩИТА: Проверка количества посещенных страниц
		if (dto.pagesVisited < 2 || dto.pagesVisited > 10) {
			throw new Error('Invalid pages visited count (2-10)')
		}

		// ЗАЩИТА: Проверка позиции
		if (dto.position && (dto.position < 1 || dto.position > 50)) {
			throw new Error('Invalid position (1-50)')
		}

		// ЗАЩИТА: Если сайт найден, позиция обязательна для SEARCH_KEYWORD
		if (
			execution.task.type === 'SEARCH_KEYWORD' &&
			dto.foundInTop &&
			!dto.position
		) {
			throw new Error('Position required when site found in top')
		}

		// РАСЧЕТ БАЛЛОВ ПО НОВОЙ ЭКОНОМИКЕ
		const pointsEarned = 5 // Исполнитель ВСЕГДА получает +5 баллов
		let pointsSpent = 0 // Сколько спишется с владельца сайта

		if (execution.task.type === 'SEARCH_KEYWORD') {
			// Поиск по ключевому слову
			if (dto.foundInTop) {
				// Сайт найден в топ-50 и посещен
				pointsSpent = 30
			} else {
				// Сайт не найден в топ-50
				pointsSpent = 10
			}
		} else if (execution.task.type === 'EXTERNAL_LINK') {
			// Переход по внешней ссылке
			if (dto.foundInTop) {
				// Ссылка найдена на сайте-доноре и работает
				pointsSpent = 10
			} else {
				// Ссылка не найдена или не работает
				pointsSpent = 5
			}
		}

		// Обновляем выполнение
		const updatedExecution = await this.prisma.execution.update({
			where: { id: executionId },
			data: {
				status: 'COMPLETED',
				foundInTop: dto.foundInTop,
				position: dto.position,
				pagesVisited: dto.pagesVisited,
				duration: dto.duration,
				completedAt: new Date(),
				pointsEarned, // Сохраняем для истории
				pointsSpent, // Сохраняем для истории
			},
		})

		// Начисляем баллы исполнителю (+5 всегда)
		await this.usersService.updateBalance(
			execution.executorId,
			pointsEarned,
			'TASK_EARNED',
			`Выполнена задача для ${execution.task.website.url}`,
			execution.taskId,
		)

		// Списываем баллы с владельца сайта
		await this.usersService.updateBalance(
			execution.task.website.userId,
			-pointsSpent,
			'TASK_SPENT',
			`Задача выполнена: ${execution.task.keyword || execution.task.externalUrl} (${dto.foundInTop ? 'найдено' : 'не найдено'})`,
			execution.taskId,
		)

		// Обновляем статус задачи
		await this.prisma.task.update({
			where: { id: execution.taskId },
			data: {
				status: 'COMPLETED',
				completedAt: new Date(),
			},
		})

		return updatedExecution
	}

	async getExecutionHistory(userId: string, limit = 50) {
		return this.prisma.execution.findMany({
			where: { executorId: userId },
			include: {
				task: {
					include: {
						website: true,
					},
				},
			},
			orderBy: { createdAt: 'desc' },
			take: limit,
		})
	}
}
