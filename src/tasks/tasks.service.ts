import {
	BadRequestException,
	Injectable,
	NotFoundException,
} from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { UsersService } from '../users/users.service'
import { CreateTaskDto } from './dto'

@Injectable()
export class TasksService {
	constructor(
		private prisma: PrismaService,
		private usersService: UsersService,
	) {}

	async create(userId: string, dto: CreateTaskDto) {
		// Проверка сайта
		const website = await this.prisma.website.findUnique({
			where: { id: dto.websiteId },
			include: { user: true },
		})

		if (!website || website.userId !== userId) {
			throw new NotFoundException('Website not found')
		}

		// Расчет стоимости задачи
		const pointsCost = this.calculateTaskCost(dto.type)

		// Проверка баланса
		if (website.user.balance < pointsCost) {
			throw new BadRequestException('Insufficient balance')
		}

		// Создание задачи
		const task = await this.prisma.task.create({
			data: {
				websiteId: dto.websiteId,
				type: dto.type,
				keyword: dto.keyword,
				externalUrl: dto.externalUrl,
				geo: dto.geo || 'Москва',
				pointsCost,
				maxYandexVisits: dto.maxYandexVisits || 3,
				maxGoogleVisits: dto.maxGoogleVisits || 3,
			},
		})

		return task
	}

	async getAvailableTask(executorId: string) {
		// Получаем задачу для выполнения (не свою)
		// Если у задачи несколько ключевых слов, выбираем случайные 1-2
		const task = await this.prisma.task.findFirst({
			where: {
				status: 'PENDING',
				website: {
					userId: {
						not: executorId,
					},
				},
			},
			orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
			include: {
				website: true,
			},
		})

		if (!task) {
			return null
		}

		// Обновляем статус задачи
		await this.prisma.task.update({
			where: { id: task.id },
			data: {
				status: 'ASSIGNED',
				assignedAt: new Date(),
			},
		})

		// Если есть несколько ключевых слов (разделенных запятой или переносом)
		// Выбираем случайные 1-2 для этого исполнителя
		if (task.keyword && task.keyword.includes(',')) {
			const keywords = task.keyword.split(',').map(k => k.trim())
			const selectedCount = Math.floor(Math.random() * 2) + 1 // 1 или 2
			const shuffled = keywords.sort(() => 0.5 - Math.random())
			const selectedKeywords = shuffled.slice(0, selectedCount)

			return {
				...task,
				keyword: selectedKeywords.join(', '),
				_originalKeywords: keywords, // Для логирования
			}
		}

		return task
	}

	async getAvailableTasks(executorId: string, limit: number = 10) {
		// Получаем все активные задачи со статусом PENDING, отсортированные по дате создания (FIFO)
		const allTasks = await this.prisma.task.findMany({
			where: {
				isActive: true,
				status: 'PENDING', // Только задачи в статусе PENDING
				website: {
					isActive: true,
					userId: {
						not: executorId, // Не свои задачи
					},
				},
			},
			include: {
				website: {
					include: {
						user: true,
					},
				},
				executions: {
					where: {
						executorId: executorId,
						status: 'COMPLETED',
					},
				},
			},
			orderBy: { createdAt: 'asc' }, // FIFO - кто первый создал
		})

		// Группируем задачи по websiteId и считаем выполнения
		const websiteExecutionCount = new Map<string, number>()
		const availableTasks = []

		for (const task of allTasks) {
			const websiteId = task.websiteId
			const currentCount = websiteExecutionCount.get(websiteId) || 0

			// Проверяем: выполнял ли пользователь задачи этого сайта
			const executionsForThisWebsite = task.executions.length

			// Максимум 2 выполнения на сайт
			if (currentCount + executionsForThisWebsite < 2) {
				availableTasks.push({
					id: task.id,
					websiteId: task.websiteId,
					websiteName: task.website.name,
					websiteUrl: task.website.url,
					keyword: task.keyword,
					type: task.type,
					geo: task.geo,
					pointsEarned: 5, // Фиксированная награда
					maxYandexVisits: task.maxYandexVisits,
					maxGoogleVisits: task.maxGoogleVisits,
					createdAt: task.createdAt,
					executionsCount: executionsForThisWebsite,
				})

				// Обновляем счетчик для этого сайта
				websiteExecutionCount.set(
					websiteId,
					currentCount + executionsForThisWebsite + 1,
				)

				// Ограничиваем количество задач
				if (availableTasks.length >= limit) {
					break
				}
			}
		}

		return availableTasks
	}

	async getUserTasks(userId: string, websiteId?: string) {
		const where: any = {
			website: {
				userId,
			},
		}

		if (websiteId) {
			where.websiteId = websiteId
		}

		const tasks = await this.prisma.task.findMany({
			where,
			include: {
				website: true,
				executions: {
					where: {
						status: 'COMPLETED',
					},
					orderBy: { createdAt: 'desc' },
				},
			},
			orderBy: { createdAt: 'desc' },
		})

		// Получаем статистику для каждой задачи
		const tasksWithStats = await Promise.all(
			tasks.map(async task => {
				// Считаем выполнения по поисковым системам
				const yandexSearches = await this.prisma.execution.count({
					where: {
						taskId: task.id,
						status: 'COMPLETED',
						// Предполагаем, что в userAgent или другом поле есть информация о поисковой системе
						// Пока используем случайное распределение 50/50
					},
				})

				const googleSearches = await this.prisma.execution.count({
					where: {
						taskId: task.id,
						status: 'COMPLETED',
					},
				})

				// Для демонстрации делим поровну
				const totalExecutions = task.executions.length
				const yandexCount = Math.floor(totalExecutions / 2)
				const googleCount = totalExecutions - yandexCount

				return {
					...task,
					stats: {
						yandexSearches: yandexCount,
						yandexVisits: yandexCount,
						googleSearches: googleCount,
						googleVisits: googleCount,
					},
				}
			}),
		)

		return tasksWithStats
	}

	async assignTask(taskId: string, executorId: string) {
		// Проверяем что задача существует и доступна для назначения
		const task = await this.prisma.task.findUnique({
			where: { id: taskId },
			include: { website: true },
		})

		if (!task) {
			throw new NotFoundException('Task not found')
		}

		if (task.status !== 'PENDING') {
			throw new BadRequestException('Task is not available for assignment')
		}

		if (task.website.userId === executorId) {
			throw new BadRequestException('Cannot assign own task')
		}

		// Обновляем статус задачи на ASSIGNED
		const updatedTask = await this.prisma.task.update({
			where: { id: taskId },
			data: {
				status: 'ASSIGNED',
				assignedAt: new Date(),
			},
		})

		return updatedTask
	}

	async getPositionHistory(taskId: string, days: number = 7) {
		const startDate = new Date()
		startDate.setDate(startDate.getDate() - days)

		const history = await this.prisma.positionHistory.findMany({
			where: {
				taskId,
				createdAt: {
					gte: startDate,
				},
			},
			orderBy: {
				createdAt: 'asc',
			},
		})

		return history
	}

	private calculateTaskCost(type: string): number {
		// Стоимость будет списана при выполнении
		// Здесь возвращаем примерную стоимость для проверки баланса
		if (type === 'SEARCH_KEYWORD') {
			return 30 // Максимальная стоимость если сайт в топ-50
		}
		return 10 // Для внешних ссылок
	}
}
