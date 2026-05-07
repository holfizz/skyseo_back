import {
	BadRequestException,
	Injectable,
	NotFoundException,
} from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { UsersService } from '../users/users.service'
import { CreateTaskDto } from './dto'

const DOMAIN_BLACKLIST = [
	'skyseo.site',
	'skyseo.ru',
	'skyseo.com',
]

// Запрещённые слова в поисковых запросах
const KEYWORD_FORBIDDEN_WORDS = [
	'порно', 'porno', 'porn', 'секс', 'sex', 'эротика', 'erotic', 'xxx',
	'наркотик', 'наркотики', 'drug', 'drugs', 'героин', 'кокаин', 'cocaine',
	'герoin', 'мефедрон', 'закладки', 'купить наркотики',
	'оружие', 'оружию', 'weapon', 'взрывчатка', 'бомба',
	'хакер', 'взлом', 'hacking', 'malware',
]

function validateKeyword(keyword: string): void {
	const trimmed = keyword.trim()

	// Минимальная длина
	if (trimmed.length < 3) {
		throw new BadRequestException('Ключевое слово слишком короткое (минимум 3 символа)')
	}

	// Нет ни одной буквы (включая кириллицу)
	if (!/\p{L}/u.test(trimmed)) {
		throw new BadRequestException('Ключевое слово должно содержать буквы')
	}

	// Слишком много цифр (не осмысленный запрос типа "123 456")
	const digits = (trimmed.match(/\d/g) || []).length
	if (digits > trimmed.length * 0.6) {
		throw new BadRequestException('Ключевое слово не должно состоять преимущественно из цифр')
	}

	// Один символ повторяется больше половины (ааааааа, 111111)
	if (/(.)\1{4,}/.test(trimmed)) {
		throw new BadRequestException('Ключевое слово содержит недопустимые повторения символов')
	}

	// Запрещённые слова
	const lower = trimmed.toLowerCase()
	for (const word of KEYWORD_FORBIDDEN_WORDS) {
		if (lower.includes(word)) {
			throw new BadRequestException('Ключевое слово содержит запрещённые слова')
		}
	}
}

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

		// Валидация ключевого слова
		if (dto.keyword) {
			validateKeyword(dto.keyword)
		}

		// Лимит 50 ключевых слов на сайт (только активные)
		const keywordCount = await this.prisma.task.count({
			where: { websiteId: dto.websiteId, isActive: true },
		})
		if (keywordCount >= 50) {
			throw new BadRequestException(
				'Достигнут лимит в 50 ключевых слов для этого сайта',
			)
		}

		// Проверка на существующий ключевик для этого сайта
		const existingTask = await this.prisma.task.findFirst({
			where: {
				websiteId: dto.websiteId,
				keyword: dto.keyword,
			},
		})

		if (existingTask) {
			if (!existingTask.isActive) {
				// Переактивируем мягко удалённый ключевик
				return this.prisma.task.update({
					where: { id: existingTask.id },
					data: { isActive: true, status: 'PENDING' },
				})
			}
			throw new BadRequestException(
				`Ключевое слово "${dto.keyword}" уже существует для этого сайта`,
			)
		}

		// Расчет стоимости задачи
		const pointsCost = this.calculateTaskCost(dto.type)

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
				useYandex: dto.useYandex !== false,
				useGoogle: dto.useGoogle !== false,
				pagesDepthFrom: dto.pagesDepthFrom || 3,
				pagesDepthTo: dto.pagesDepthTo || 5,
				pageDurationFrom: dto.pageDurationFrom || 60,
				pageDurationTo: dto.pageDurationTo || 180,
			},
		})

		return task
	}

	async getAvailableTask(executorId: string) {
		// Получаем задачу для выполнения (не свою)
		// Если у задачи несколько ключевых слов, выбираем случайные 1-2
		const task = await this.prisma.task.findFirst({
			where: {
				isActive: true,
				status: 'PENDING',
				website: {
					isActive: true,
					userId: { not: executorId },
					NOT: DOMAIN_BLACKLIST.map(d => ({ url: { contains: d } })),
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

	// Получить начало текущей недели (понедельник 00:00)
	private getWeekStart(date: Date = new Date()): Date {
		const d = new Date(date)
		const day = d.getDay()
		const diff = d.getDate() - day + (day === 0 ? -6 : 1) // Понедельник
		d.setDate(diff)
		d.setHours(0, 0, 0, 0)
		return d
	}

	async getAvailableTasks(executorId: string, limit: number = 10) {
		const weekStart = this.getWeekStart()

		// Получаем все активные задачи со статусом PENDING, отсортированные по дате создания (FIFO)
		const allTasks = await this.prisma.task.findMany({
			where: {
				isActive: true,
				status: 'PENDING',
				website: {
					isActive: true,
					userId: { not: executorId },
					NOT: DOMAIN_BLACKLIST.map(d => ({ url: { contains: d } })),
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
						weekStart: weekStart,
						status: 'COMPLETED',
					},
				},
			},
			orderBy: { createdAt: 'asc' }, // FIFO - кто первый создал
		})

		// Группируем задачи по websiteId и считаем выполнения за текущую неделю
		const websiteExecutionCount = new Map<string, number>()
		const availableTasks = []

		for (const task of allTasks) {
			// Дополнительная защита: никогда не возвращаем собственные задачи
			if (task.website.userId === executorId) continue
			const websiteId = task.websiteId

			// Проверяем: сколько раз пользователь выполнял задачи этого сайта на этой неделе
			const executionsThisWeek = task.executions.length

			// Максимум 2 выполнения на сайт в неделю
			if (executionsThisWeek < 2) {
				availableTasks.push({
					id: task.id,
					websiteId: task.websiteId,
					websiteName: task.website.name,
					websiteUrl: task.website.url,
					keyword: task.keyword,
					type: task.type,
					geo: task.geo,
					pointsEarned: 15, // Максимальная награда (если найдено)
					minPointsEarned: 5, // Минимальная награда (если не найдено)
					maxYandexVisits: task.maxYandexVisits,
					maxGoogleVisits: task.maxGoogleVisits,
					createdAt: task.createdAt,
					executionsThisWeek: executionsThisWeek,
					remainingExecutions: 2 - executionsThisWeek,
				})

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
			isActive: true,
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
				positionHistory: {
					orderBy: { createdAt: 'desc' },
					take: 1,
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

				const latestPosition = task.positionHistory[0] ?? null
				return {
					...task,
					currentYandexPosition: latestPosition?.yandexPosition ?? null,
					currentGooglePosition: latestPosition?.googlePosition ?? null,
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
		// Используем транзакцию для атомарного назначения задачи
		try {
			const result = await this.prisma.$transaction(async prisma => {
				// Проверяем что задача существует и доступна для назначения
				const task = await prisma.task.findUnique({
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
				const updatedTask = await prisma.task.update({
					where: {
						id: taskId,
						status: 'PENDING', // Дополнительная проверка в WHERE
					},
					data: {
						status: 'ASSIGNED',
						assignedAt: new Date(),
					},
				})

				return updatedTask
			})

			return result
		} catch (error) {
			// Если задача уже была назначена между проверкой и обновлением
			if (error.code === 'P2025') {
				throw new BadRequestException('Task is not available for assignment')
			}
			throw error
		}
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

	async saveInitialPosition(
		taskId: string,
		yandexPosition: number | null,
		googlePosition: number | null = null,
	) {
		// Prevent duplicate records within the same hour (e.g. rapid recheck spam)
		const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
		const recentRecord = await this.prisma.positionHistory.findFirst({
			where: { taskId, createdAt: { gte: oneHourAgo } },
			orderBy: { createdAt: 'desc' },
		})

		if (recentRecord) {
			// Update the recent record instead of duplicating
			return this.prisma.positionHistory.update({
				where: { id: recentRecord.id },
				data: {
					yandexPosition: yandexPosition ?? recentRecord.yandexPosition,
					googlePosition: googlePosition ?? recentRecord.googlePosition,
				},
			})
		}

		const record = await this.prisma.positionHistory.create({
			data: { taskId, yandexPosition, googlePosition },
		})

		console.log(
			`[TasksService] ✅ Позиция: taskId=${taskId}, Яндекс=${yandexPosition ?? 'нет'}, Google=${googlePosition ?? 'нет'}`,
		)

		return record
	}

	async deleteTask(userId: string, taskId: string) {
		const task = await this.prisma.task.findUnique({
			where: { id: taskId },
			include: { website: true },
		})

		if (!task || task.website.userId !== userId) {
			throw new NotFoundException('Task not found')
		}

		// Мягкое удаление — не трогаем executions других пользователей и историю позиций
		await this.prisma.task.update({
			where: { id: taskId },
			data: { isActive: false, status: 'PENDING' },
		})
		return { success: true }
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
