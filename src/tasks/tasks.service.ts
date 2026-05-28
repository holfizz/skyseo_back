import {
	BadRequestException,
	Injectable,
	NotFoundException,
} from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { UsersService } from '../users/users.service'
import { CreateTaskDto, UpdateTaskDto } from './dto'

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

		// Лимит ключевых слов на сайт (только активные).
		// Сеть распределяет визиты по всем ключам, так что допускаем большие списки.
		const keywordCount = await this.prisma.task.count({
			where: { websiteId: dto.websiteId, isActive: true },
		})
		if (keywordCount >= 200) {
			throw new BadRequestException(
				'Достигнут лимит в 200 ключевых слов для этого сайта',
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
					data: {
						isActive: true,
						status: 'PENDING',
						assignedAt: null,
						assignedExecutorId: null,
					},
				})
			}
			throw new BadRequestException(
				`Ключевое слово "${dto.keyword}" уже существует для этого сайта`,
			)
		}

		// Расчет стоимости задачи
		const pointsCost = this.calculateTaskCost(
			dto.type,
			dto.useYandex !== false,
			dto.useGoogle !== false,
		)

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

	async getAvailableTasks(executorId: string, limit: number = 10) {
		const safeLimit = Math.max(1, Math.min(limit, 100))

		// Cooldown: один и тот же ключевик не чаще раза в 15 дней на исполнителя
		const cooldownDate = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000)

		// ПФ-маскировка: один executor не должен находить один и тот же сайт по
		// многим разным ключевикам — Яндекс кластеризует юзеров и ловит паттерн.
		// Лимиты на уровне сайта:
		//   • max 2 выполнения одного сайта за 30 дней на одного executor
		//   • spacing: следующий визит того же сайта не раньше чем через 10 дней
		const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
		const minGapAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)

		const monthlyHitsBySite = await this.prisma.execution.groupBy({
			by: ['websiteId'],
			where: {
				executorId,
				status: 'COMPLETED',
				completedAt: { gte: monthAgo },
			},
			_count: { _all: true },
		})
		const sitesAtMonthlyLimit = monthlyHitsBySite
			.filter(s => s._count._all >= 2)
			.map(s => s.websiteId)

		const sitesVisitedRecently = await this.prisma.execution
			.findMany({
				where: {
					executorId,
					status: 'COMPLETED',
					completedAt: { gte: minGapAgo },
				},
				select: { websiteId: true },
				distinct: ['websiteId'],
			})
			.then(r => r.map(e => e.websiteId))

		const blockedWebsiteIds = Array.from(
			new Set([...sitesAtMonthlyLimit, ...sitesVisitedRecently]),
		)

		// Задачи, где ключевик не найден у этого исполнителя — больше не показывать
		const notInSerpTaskIds = await this.prisma.execution
			.findMany({
				where: { executorId, status: 'FAILED', failureReason: 'NOT_IN_SERP' },
				select: { taskId: true },
				distinct: ['taskId'],
			})
			.then(r => r.map(e => e.taskId))

		const allTasks = await this.prisma.task.findMany({
			where: {
				isActive: true,
				keywordStatus: 'ACTIVE',
				status: 'PENDING',
				...(notInSerpTaskIds.length > 0 ? { id: { notIn: notInSerpTaskIds } } : {}),
				executions: {
					none: {
						executorId,
						status: 'COMPLETED',
						completedAt: { gte: cooldownDate },
					},
				},
				website: {
					isActive: true,
					userId: { not: executorId },
					...(blockedWebsiteIds.length > 0 ? { id: { notIn: blockedWebsiteIds } } : {}),
					NOT: DOMAIN_BLACKLIST.map(d => ({ url: { contains: d } })),
				},
			},
			include: {
				website: {
					include: {
						user: true,
					},
				},
			},
			orderBy: { createdAt: 'asc' }, // FIFO - кто первый создал
			// Окно кандидатов ФИКСИРОВАННОЕ (не зависит от limit). Иначе count
			// (limit=100 → окно 300) и loop (limit=5 → окно 150) сканируют разное
			// число задач: если первые 150 сидят на сайтах в дневном капе, count
			// видит свободные на позициях 150-300 и пишет «99 доступно», а loop
			// возвращает 0 → «нет задач» при реально доступных. Одинаковое окно
			// гарантирует, что результат loop — всегда префикс результата count.
			take: 300,
		})

		// Дневной cap считается на УРОВНЕ САЙТА (не ключевика).
		// Антифрод Яндекса смотрит на трафик на домен — 10 ключей × 20 визитов = 200/день
		// на один домен = красный флаг. Нужен общий site-cap.
		const dayAgo24h = new Date(Date.now() - 24 * 60 * 60 * 1000)
		const candidateSiteIds = Array.from(new Set(allTasks.map(t => t.websiteId)))

		// Сегодняшние выполнения по сайтам
		const todayCountsBySite = candidateSiteIds.length > 0
			? await this.prisma.execution.groupBy({
				by: ['websiteId'],
				where: {
					websiteId: { in: candidateSiteIds },
					status: 'COMPLETED',
					completedAt: { gte: dayAgo24h },
				},
				_count: { _all: true },
			})
			: []
		const todayCountBySite = new Map(todayCountsBySite.map(c => [c.websiteId, c._count._all]))

		// Site target = website.dailyVisitsTarget (если задан явно) либо сумма target'ов всех АКТИВНЫХ ключей сайта
		const allSiteTasks = candidateSiteIds.length > 0
			? await this.prisma.task.findMany({
				where: { websiteId: { in: candidateSiteIds }, isActive: true, keywordStatus: 'ACTIVE' },
				select: { websiteId: true, type: true, maxYandexVisits: true, maxGoogleVisits: true, useYandex: true, useGoogle: true },
			})
			: []
		const siteTargetMap = new Map<string, number>()
		for (const t of allSiteTasks) {
			const cur = siteTargetMap.get(t.websiteId) ?? 0
			siteTargetMap.set(t.websiteId, cur + this.getTaskDailyTarget(t))
		}
		// Явный override из website.dailyVisitsTarget (если задан пользователем)
		const websiteOverrides = candidateSiteIds.length > 0
			? await this.prisma.website.findMany({
				where: { id: { in: candidateSiteIds }, dailyVisitsTarget: { not: null } },
				select: { id: true, dailyVisitsTarget: true },
			})
			: []
		for (const w of websiteOverrides) {
			if (w.dailyVisitsTarget != null) siteTargetMap.set(w.id, w.dailyVisitsTarget)
		}

		// Потолок от размера сети (кэш 5 мин)
		const networkCap = await this.getNetworkPerSiteCapacity()

		const availableTasks = []

		for (const task of allTasks) {
			// Дополнительная защита: никогда не возвращаем собственные задачи
			if (task.website.userId === executorId) continue
			if (task.website.user.balance < this.getTaskOwnerMaxCost(task)) continue

			// Site daily cap: эффективный target = min(пользовательский, network),
			// потом warm-up разгон от website.createdAt
			const userSiteTarget = siteTargetMap.get(task.websiteId) ?? 0
			const cappedTarget = Math.min(userSiteTarget, networkCap)
			const rampedCap = this.rampedDailyCap(cappedTarget, task.website.createdAt)
			const todayOnSite = todayCountBySite.get(task.websiteId) ?? 0
			if (todayOnSite >= rampedCap) continue

			const reward = this.getTaskRewardBounds(task)
			availableTasks.push({
				id: task.id,
				websiteId: task.websiteId,
				websiteName: task.website.name,
				websiteUrl: task.website.url,
				keyword: task.keyword,
				targetUrl: task.targetUrl,
				type: task.type,
				geo: task.geo,
				pointsEarned: reward.max,
				minPointsEarned: reward.min,
				maxYandexVisits: task.maxYandexVisits,
				maxGoogleVisits: task.maxGoogleVisits,
				useYandex: task.useYandex,
				useGoogle: task.useGoogle,
				createdAt: task.createdAt,
				alreadyCompleted: false,
				remainingExecutions: 1,
			})
			if (availableTasks.length >= safeLimit) break
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
				const [yandexCount, googleCount] = await Promise.all([
					this.prisma.execution.count({
						where: {
							taskId: task.id,
							status: 'COMPLETED',
							yandexFoundInTop: { not: null },
						},
					}),
					this.prisma.execution.count({
						where: {
							taskId: task.id,
							status: 'COMPLETED',
							googleFoundInTop: { not: null },
						},
					}),
				])

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
					include: {
						website: {
							include: {
								user: {
									select: { balance: true },
								},
							},
						},
					},
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

				const cooldownDate = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000)
				const alreadyCompleted = await prisma.execution.count({
					where: {
						taskId,
						executorId,
						status: 'COMPLETED',
						completedAt: { gte: cooldownDate },
					},
				})

				if (alreadyCompleted > 0) {
					throw new BadRequestException('Task already completed by this user recently')
				}

				// ПФ-маскировка: лимиты на сайт от одного executor
				const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
				const minGapAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)

				const siteVisitsThisMonth = await prisma.execution.count({
					where: {
						websiteId: task.websiteId,
						executorId,
						status: 'COMPLETED',
						completedAt: { gte: monthAgo },
					},
				})
				if (siteVisitsThisMonth >= 2) {
					throw new BadRequestException('Monthly site limit reached for this user')
				}

				const siteVisitRecently = await prisma.execution.count({
					where: {
						websiteId: task.websiteId,
						executorId,
						status: 'COMPLETED',
						completedAt: { gte: minGapAgo },
					},
				})
				if (siteVisitRecently > 0) {
					throw new BadRequestException('Site spacing — try again in 10 days')
				}

				// Site daily cap с warm-up: считается на УРОВНЕ САЙТА (не ключа).
				// target = сумма target'ов всех активных ключей сайта, кэп min(target, network),
				// потом плавный разгон от 3 в первый день до полного потолка за 14 дней.
				const dayAgo24h = new Date(Date.now() - 24 * 60 * 60 * 1000)
				const todayOnSite = await prisma.execution.count({
					where: { websiteId: task.websiteId, status: 'COMPLETED', completedAt: { gte: dayAgo24h } },
				})
				// Site target: явный override из website.dailyVisitsTarget или сумма ключей
				const userSiteTarget = task.website.dailyVisitsTarget ?? await (async () => {
					const siteTasksForTarget = await prisma.task.findMany({
						where: { websiteId: task.websiteId, isActive: true, keywordStatus: 'ACTIVE' },
						select: { type: true, maxYandexVisits: true, maxGoogleVisits: true, useYandex: true, useGoogle: true },
					})
					return siteTasksForTarget.reduce(
						(sum, t) => sum + this.getTaskDailyTarget(t),
						0,
					)
				})()
				const networkCap = await this.getNetworkPerSiteCapacity()
				const cappedTarget = Math.min(userSiteTarget, networkCap)
				const rampedCap = this.rampedDailyCap(cappedTarget, task.website.createdAt)
				if (todayOnSite >= rampedCap) {
					throw new BadRequestException('Daily site cap reached (warm-up / network limit)')
				}

				if (task.website.user.balance < this.getTaskOwnerMaxCost(task)) {
					await prisma.task.update({
						where: { id: taskId },
						data: {
							isActive: false,
							status: 'PENDING',
							assignedAt: null,
							assignedExecutorId: null,
						},
					})
					return {
						task: null,
						insufficientBalance: true,
					}
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
						assignedExecutorId: executorId,
					},
				})

				return {
					task: updatedTask,
					insufficientBalance: false,
				}
			})

			if (result.insufficientBalance) {
				throw new BadRequestException('Task owner has insufficient balance')
			}

			return result.task
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

	async updateTask(userId: string, taskId: string, dto: UpdateTaskDto) {
		const task = await this.prisma.task.findUnique({
			where: { id: taskId },
			include: { website: true },
		})

		if (!task || task.website.userId !== userId) {
			throw new NotFoundException('Task not found')
		}

		return this.prisma.task.update({
			where: { id: taskId },
			data: {
				...(dto.maxYandexVisits !== undefined && { maxYandexVisits: dto.maxYandexVisits }),
				...(dto.maxGoogleVisits !== undefined && { maxGoogleVisits: dto.maxGoogleVisits }),
				...(dto.useYandex !== undefined && { useYandex: dto.useYandex }),
				...(dto.useGoogle !== undefined && { useGoogle: dto.useGoogle }),
				...(dto.pagesDepthFrom !== undefined && { pagesDepthFrom: dto.pagesDepthFrom }),
				...(dto.pagesDepthTo !== undefined && { pagesDepthTo: dto.pagesDepthTo }),
				...(dto.pageDurationFrom !== undefined && { pageDurationFrom: dto.pageDurationFrom }),
				...(dto.pageDurationTo !== undefined && { pageDurationTo: dto.pageDurationTo }),
				...(dto.isActive !== undefined && { isActive: dto.isActive }),
				...(dto.targetUrl !== undefined && { targetUrl: dto.targetUrl || null }),
			},
		})
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
			data: {
				isActive: false,
				status: 'PENDING',
				assignedAt: null,
				assignedExecutorId: null,
			},
		})
		return { success: true }
	}

	// Целевой дневной лимит задачи: сумма maxYandexVisits + maxGoogleVisits с учётом
	// какие движки реально включены. Это потолок, к которому ramp-up разгоняется.
	private getTaskDailyTarget(task: {
		type: string
		maxYandexVisits?: number | null
		maxGoogleVisits?: number | null
		useYandex?: boolean | null
		useGoogle?: boolean | null
	}): number {
		if (task.type === 'EXTERNAL_LINK') {
			return Math.max(1, task.maxYandexVisits ?? 5)
		}
		const yandex = task.useYandex !== false ? (task.maxYandexVisits ?? 5) : 0
		const google = task.useGoogle !== false ? (task.maxGoogleVisits ?? 5) : 0
		return Math.max(1, yandex + google)
	}

	// Сколько визитов в день на ОДИН сайт физически может выдать сеть.
	// Каждая нода: max 2 визита на сайт за 30 дней → 2/30 в день на сайт.
	// Если активных нод 500 → ~33/день/сайт. Если 5000 → ~333/день/сайт.
	// Кэш 5 минут — запрос на distinct executors недешёвый.
	private networkCapCache: { value: number; expiresAt: number } | null = null
	private async getNetworkPerSiteCapacity(): Promise<number> {
		const now = Date.now()
		if (this.networkCapCache && this.networkCapCache.expiresAt > now) {
			return this.networkCapCache.value
		}
		const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000)
		const distinctExecutors = await this.prisma.execution.findMany({
			where: { completedAt: { gte: weekAgo }, status: 'COMPLETED' },
			select: { executorId: true },
			distinct: ['executorId'],
		})
		const activeCount = distinctExecutors.length
		const capacity = Math.max(3, Math.floor((activeCount * 2) / 30))
		this.networkCapCache = { value: capacity, expiresAt: now + 5 * 60 * 1000 }
		return capacity
	}

	// Плавный warm-up: первый день — 3 визита, к 14-му дню — target.
	// Кривая ease-in (x²) — медленный старт, ускорение к концу.
	// Защищает новые сайты от резкого всплеска трафика, который ловит антифрод Яндекса.
	private rampedDailyCap(targetMax: number, createdAt: Date): number {
		const START_CAP = 3
		const RAMP_DAYS = 14
		const daysActive = Math.max(
			0,
			Math.floor((Date.now() - createdAt.getTime()) / (24 * 60 * 60 * 1000)),
		)
		if (daysActive >= RAMP_DAYS) return targetMax
		if (targetMax <= START_CAP) return targetMax
		const progress = daysActive / RAMP_DAYS
		const eased = progress * progress
		return Math.max(START_CAP, Math.floor(START_CAP + (targetMax - START_CAP) * eased))
	}

	private getTaskRewardBounds(task: {
		type: string
		useYandex?: boolean | null
		useGoogle?: boolean | null
	}) {
		if (task.type === 'EXTERNAL_LINK') {
			return { min: 5, max: 5 }
		}

		const enabledEngines =
			(task.useYandex !== false ? 1 : 0) + (task.useGoogle !== false ? 1 : 0)
		const engines = Math.max(1, enabledEngines)

		return {
			min: engines * 5,
			max: engines * 15,
		}
	}

	private getTaskOwnerMaxCost(task: {
		type: string
		useYandex?: boolean | null
		useGoogle?: boolean | null
	}) {
		if (task.type === 'EXTERNAL_LINK') {
			return 10
		}

		const enabledEngines =
			(task.useYandex !== false ? 1 : 0) + (task.useGoogle !== false ? 1 : 0)

		return Math.max(1, enabledEngines) * 30
	}

	private calculateTaskCost(
		type: string,
		useYandex: boolean = true,
		useGoogle: boolean = true,
	): number {
		// Стоимость будет списана при выполнении
		// Здесь возвращаем примерную стоимость для проверки баланса
		if (type === 'SEARCH_KEYWORD' || type === 'SEARCH_AND_VISIT') {
			const enabledEngines = (useYandex ? 1 : 0) + (useGoogle ? 1 : 0)
			return Math.max(1, enabledEngines) * 30
		}
		return 10 // Для внешних ссылок
	}
}
