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

	// Получить начало текущей недели (понедельник 00:00)
	private getWeekStart(date: Date = new Date()): Date {
		const d = new Date(date)
		const day = d.getDay()
		const diff = d.getDate() - day + (day === 0 ? -6 : 1) // Понедельник
		d.setDate(diff)
		d.setHours(0, 0, 0, 0)
		return d
	}

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

		// Проверяем лимит выполнений для этого сайта (2 раза в неделю)
		const weekStart = this.getWeekStart()
		const executionsThisWeek = await this.prisma.execution.count({
			where: {
				executorId,
				websiteId: task.websiteId,
				weekStart,
				status: 'COMPLETED',
			},
		})

		if (executionsThisWeek >= 2) {
			throw new Error(
				'Вы уже выполнили 2 задачи для этого сайта на этой неделе',
			)
		}

		const execution = await this.prisma.execution.create({
			data: {
				taskId,
				executorId,
				websiteId: task.websiteId,
				ipAddress,
				userAgent,
				weekStart,
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
		// Исполнитель:
		// - Если сайт найден в поиске и открыт: +15 баллов
		// - Если сайт не найден, но ссылка открыта: +5 баллов
		// Владелец сайта:
		// - Если сайт найден в поиске: -30 баллов
		// - Если сайт не найден в поиске: -10 баллов
		let pointsEarned = 0
		let pointsSpent = 0

		if (
			execution.task.type === 'SEARCH_KEYWORD' ||
			execution.task.type === 'SEARCH_AND_VISIT'
		) {
			// Поиск по ключевому слову
			if (dto.foundInTop) {
				// Сайт найден в топ-50 и посещен
				pointsEarned = 15 // Исполнитель получает +15
				pointsSpent = 30 // Владелец платит -30
			} else {
				// Сайт не найден в топ-50
				pointsEarned = 5 // Исполнитель получает +5 за попытку
				pointsSpent = 10 // Владелец платит -10
			}
		} else if (execution.task.type === 'EXTERNAL_LINK') {
			// Переход по внешней ссылке
			if (dto.foundInTop) {
				// Ссылка найдена на сайте-доноре и работает
				pointsEarned = 5
				pointsSpent = 10
			} else {
				// Ссылка не найдена или не работает
				pointsEarned = 5
				pointsSpent = 10
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

		// Начисляем баллы исполнителю
		console.log(
			`[ExecutionsService] Начисляем ${pointsEarned} баллов исполнителю ${execution.executorId}`,
		)

		const taskDescription = execution.task.keyword
			? `Поиск "${execution.task.keyword}" на ${execution.task.website.url}`
			: `Переход по ссылке ${execution.task.externalUrl}`

		const earnedDescription = dto.foundInTop
			? `${taskDescription} (найдено в поиске)`
			: `${taskDescription} (не найдено в поиске)`

		await this.usersService.updateBalance(
			execution.executorId,
			pointsEarned,
			'TASK_EARNED',
			earnedDescription,
			execution.taskId,
		)
		console.log(`[ExecutionsService] ✅ Баллы начислены исполнителю`)

		// Списываем баллы с владельца сайта
		console.log(
			`[ExecutionsService] Списываем ${pointsSpent} баллов с владельца ${execution.task.website.userId}`,
		)

		// Проверяем баланс владельца перед списанием
		const ownerBalance = execution.task.website.user.balance
		if (ownerBalance < pointsSpent) {
			console.log(
				`[ExecutionsService] ❌ Недостаточно баллов у владельца (${ownerBalance} < ${pointsSpent}). Задача будет деактивирована.`,
			)

			// Деактивируем задачу если недостаточно баллов
			await this.prisma.task.update({
				where: { id: execution.taskId },
				data: { isActive: false },
			})

			throw new Error(
				`Недостаточно баллов у владельца сайта. Задача деактивирована.`,
			)
		}

		const spentDescription = dto.foundInTop
			? `Задача выполнена: ${taskDescription} (найдено в поиске)`
			: `Задача выполнена: ${taskDescription} (не найдено в поиске)`

		await this.usersService.updateBalance(
			execution.task.website.userId,
			-pointsSpent,
			'TASK_SPENT',
			spentDescription,
			execution.taskId,
		)
		console.log(`[ExecutionsService] ✅ Баллы списаны с владельца`)

		// НЕ меняем статус задачи - она остается PENDING для следующих выполнений
		// Задача выполняется много раз разными исполнителями

		// Сохраняем историю позиций (для SEARCH_KEYWORD и SEARCH_AND_VISIT)
		const shouldSavePosition =
			execution.task.type === 'SEARCH_KEYWORD' ||
			execution.task.type === 'SEARCH_AND_VISIT'

		if (
			shouldSavePosition &&
			(dto.yandexPosition || dto.googlePosition || dto.position)
		) {
			await this.prisma.positionHistory.create({
				data: {
					taskId: execution.taskId,
					yandexPosition: dto.yandexPosition ?? dto.position ?? null,
					googlePosition: dto.googlePosition ?? dto.position ?? null,
				},
			})
			console.log(
				`[ExecutionsService] ✅ История позиций сохранена: Яндекс=${dto.yandexPosition ?? dto.position ?? 'нет'}, Google=${dto.googlePosition ?? dto.position ?? 'нет'}`,
			)
		}

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
