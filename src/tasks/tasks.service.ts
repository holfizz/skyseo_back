import {
	BadRequestException,
	Injectable,
	NotFoundException,
} from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { UsersService } from '../users/users.service'
import { CreateTaskDto, UpdateTaskDto } from './dto'

const DOMAIN_BLACKLIST = ['skyseo.site', 'skyseo.ru', 'skyseo.com']

// Запрещённые слова в поисковых запросах
const KEYWORD_FORBIDDEN_WORDS = [
	'порно',
	'porno',
	'porn',
	'секс',
	'sex',
	'эротика',
	'erotic',
	'xxx',
	'наркотик',
	'наркотики',
	'drug',
	'drugs',
	'героин',
	'кокаин',
	'cocaine',
	'герoin',
	'мефедрон',
	'закладки',
	'купить наркотики',
	'оружие',
	'оружию',
	'weapon',
	'взрывчатка',
	'бомба',
	'хакер',
	'взлом',
	'hacking',
	'malware',
]

function validateKeyword(keyword: string): void {
	const trimmed = keyword.trim()

	// Минимальная длина
	if (trimmed.length < 3) {
		throw new BadRequestException(
			'Ключевое слово слишком короткое (минимум 3 символа)',
		)
	}

	// Нет ни одной буквы (включая кириллицу)
	if (!/\p{L}/u.test(trimmed)) {
		throw new BadRequestException('Ключевое слово должно содержать буквы')
	}

	// Слишком много цифр (не осмысленный запрос типа "123 456")
	const digits = (trimmed.match(/\d/g) || []).length
	if (digits > trimmed.length * 0.6) {
		throw new BadRequestException(
			'Ключевое слово не должно состоять преимущественно из цифр',
		)
	}

	// Один символ повторяется больше половины (ааааааа, 111111)
	if (/(.)\1{4,}/.test(trimmed)) {
		throw new BadRequestException(
			'Ключевое слово содержит недопустимые повторения символов',
		)
	}

	// Запрещённые слова (только целые слова, не подстроки)
	const lower = trimmed.toLowerCase()
	const kwTokens = lower.split(/[\s\-_]+/)
	for (const forbidden of KEYWORD_FORBIDDEN_WORDS) {
		const found = forbidden.includes(' ')
			? lower.includes(forbidden)
			: kwTokens.includes(forbidden)
		if (found) {
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
		const { candidates } = await this.computeAvailability(executorId)

		return candidates.slice(0, safeLimit).map(({ task }) => {
			const reward = this.getTaskRewardBounds(task)
			return {
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
			}
		})
	}

	// Единый расчёт доступности: и выдача задач, и диагностика «почему 0» берут цифры
	// отсюда — чтобы debug всегда совпадал с реальной фильтрацией (нет двух копий логики).
	private async computeAvailability(executorId: string) {
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

		// Задачи, где ключевик не найден этим исполнителем — скрываем на 30 дней, затем
		// перепроверяем (позиции меняются, в т.ч. благодаря самому ПФ). Мёртвые ключи
		// и так уходят в keywordStatus=RESTRICTED после 10 подряд NOT_IN_SERP.
		const notInSerpSince = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
		const notInSerpTaskIds = await this.prisma.execution
			.findMany({
				where: {
					executorId,
					status: 'FAILED',
					failureReason: 'NOT_IN_SERP',
					completedAt: { gte: notInSerpSince },
				},
				select: { taskId: true },
				distinct: ['taskId'],
			})
			.then(r => r.map(e => e.taskId))

		// Базовый фильтр доступных для исполнителя задач (без site-cap)
		const eligibleTaskWhere = {
			isActive: true,
			keywordStatus: 'ACTIVE' as const,
			status: 'PENDING' as const,
			...(notInSerpTaskIds.length > 0
				? { id: { notIn: notInSerpTaskIds } }
				: {}),
			executions: {
				none: {
					executorId,
					status: 'COMPLETED' as const,
					completedAt: { gte: cooldownDate },
				},
			},
			website: {
				isActive: true,
				userId: { not: executorId },
				...(blockedWebsiteIds.length > 0
					? { id: { notIn: blockedWebsiteIds } }
					: {}),
				NOT: DOMAIN_BLACKLIST.map(d => ({ url: { contains: d } })),
			},
		}

		// Сайты, у которых вообще есть eligible-задачи (distinct — ограничено числом сайтов)
		const eligibleSiteIds = await this.prisma.task
			.findMany({
				where: eligibleTaskWhere,
				select: { websiteId: true },
				distinct: ['websiteId'],
			})
			.then(r => r.map(t => t.websiteId))

		const networkCap = await this.getNetworkPerSiteCapacity()

		// Диагностика «почему 0»: executor-scoped счётчики блокировок.
		// sitesAtDailyCap доуточняется ниже после расчёта дневных cap'ов по eligible-сайтам.
		const diag = {
			networkCap,
			blockedByNotInSerp: notInSerpTaskIds.length,
			blockedByMonthlyLimit: sitesAtMonthlyLimit.length,
			blockedByRecentVisit10d: sitesVisitedRecently.length,
			eligibleSiteCount: eligibleSiteIds.length,
			sitesAtDailyCap: 0,
		}

		if (eligibleSiteIds.length === 0) return { candidates: [], diag }

		// Дневной cap считается на УРОВНЕ САЙТА (не ключевика).
		// Антифрод Яндекса смотрит на трафик на домен — 10 ключей × 20 визитов = 200/день
		// на один домен = красный флаг. Нужен общий site-cap.
		// Считаем cap для ВСЕХ eligible-сайтов ДО окна кандидатов — иначе закапанные
		// сайты съедают окно и реально доступные задачи (за позицией 300) не выдаются.
		const dayAgo24h = new Date(Date.now() - 24 * 60 * 60 * 1000)

		const todayCountsBySite = await this.prisma.execution.groupBy({
			by: ['websiteId'],
			where: {
				websiteId: { in: eligibleSiteIds },
				status: 'COMPLETED',
				completedAt: { gte: dayAgo24h },
			},
			_count: { _all: true },
		})
		const todayCountBySite = new Map(
			todayCountsBySite.map(c => [c.websiteId, c._count._all]),
		)

		// Site target = website.dailyVisitsTarget (если задан явно) либо сумма target'ов всех АКТИВНЫХ ключей сайта
		const allSiteTasks = await this.prisma.task.findMany({
			where: {
				websiteId: { in: eligibleSiteIds },
				isActive: true,
				keywordStatus: 'ACTIVE',
			},
			select: {
				websiteId: true,
				type: true,
				maxYandexVisits: true,
				maxGoogleVisits: true,
				useYandex: true,
				useGoogle: true,
			},
		})
		const siteTargetMap = new Map<string, number>()
		for (const t of allSiteTasks) {
			const cur = siteTargetMap.get(t.websiteId) ?? 0
			siteTargetMap.set(t.websiteId, cur + this.getTaskDailyTarget(t))
		}

		// Метаданные сайтов: createdAt (warm-up), override target, владелец (платный приоритет)
		const websiteMeta = await this.prisma.website.findMany({
			where: { id: { in: eligibleSiteIds } },
			select: {
				id: true,
				createdAt: true,
				dailyVisitsTarget: true,
				userId: true,
			},
		})

		const paidOwners = await this.getPaidPriorityOwners()

		// Для каждого eligible-сайта: остался ли дневной лимит. Закапанные исключаем.
		const siteInfo = new Map<string, { fillRatio: number; isPaid: boolean }>()
		for (const site of websiteMeta) {
			const userSiteTarget =
				site.dailyVisitsTarget ?? siteTargetMap.get(site.id) ?? 0
			const cappedTarget = Math.min(userSiteTarget, networkCap)
			const rampedCap = this.rampedDailyCap(cappedTarget, site.createdAt)
			const todayOnSite = todayCountBySite.get(site.id) ?? 0
			if (todayOnSite >= rampedCap) continue // сайт упёрся в дневной cap
			siteInfo.set(site.id, {
				fillRatio: rampedCap > 0 ? todayOnSite / rampedCap : 1,
				isPaid: paidOwners.has(site.userId),
			})
		}

		const availableSiteIds = Array.from(siteInfo.keys())
		// Сайты, отвалившиеся именно из-за дневного cap (реальный rampedDailyCap, только eligible)
		diag.sitesAtDailyCap = eligibleSiteIds.length - availableSiteIds.length
		if (availableSiteIds.length === 0) return { candidates: [], diag }

		// Окно кандидатов только по НЕзакапанным сайтам → все 300 реально доступны.
		const allTasks = await this.prisma.task.findMany({
			where: {
				...eligibleTaskWhere,
				website: { ...eligibleTaskWhere.website, id: { in: availableSiteIds } },
			},
			include: { website: { include: { user: true } } },
			orderBy: { createdAt: 'asc' }, // FIFO внутри равных по нагрузке/приоритету
			take: 300,
		})

		const candidates = []
		for (const task of allTasks) {
			if (task.website.userId === executorId) continue // защита: не свои
			if (task.website.user.balance < this.getTaskOwnerMaxCost(task)) continue
			const info = siteInfo.get(task.websiteId)
			if (!info) continue
			candidates.push({ task, isPaid: info.isPaid, fillRatio: info.fillRatio })
		}

		// Приоритет выдачи: платные сайты → наименее загруженные сегодня → случайный порядок.
		// Случайность внутри одного тира гарантирует честное распределение между исполнителями:
		// двое запросивших одновременно получат разные задачи, а не одну и ту же.
		const withSalt = candidates.map(c => ({ ...c, _salt: Math.random() }))
		withSalt.sort((a, b) => {
			if (a.isPaid !== b.isPaid) return a.isPaid ? -1 : 1
			if (a.fillRatio !== b.fillRatio) return a.fillRatio - b.fillRatio
			return a._salt - b._salt
		})
		return { candidates: withSalt, diag }
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
					throw new BadRequestException(
						'Task already completed by this user recently',
					)
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
					throw new BadRequestException(
						'Monthly site limit reached for this user',
					)
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
					where: {
						websiteId: task.websiteId,
						status: 'COMPLETED',
						completedAt: { gte: dayAgo24h },
					},
				})
				// Site target: явный override из website.dailyVisitsTarget или сумма ключей
				const userSiteTarget =
					task.website.dailyVisitsTarget ??
					(await (async () => {
						const siteTasksForTarget = await prisma.task.findMany({
							where: {
								websiteId: task.websiteId,
								isActive: true,
								keywordStatus: 'ACTIVE',
							},
							select: {
								type: true,
								maxYandexVisits: true,
								maxGoogleVisits: true,
								useYandex: true,
								useGoogle: true,
							},
						})
						return siteTasksForTarget.reduce(
							(sum, t) => sum + this.getTaskDailyTarget(t),
							0,
						)
					})())
				const networkCap = await this.getNetworkPerSiteCapacity()
				const cappedTarget = Math.min(userSiteTarget, networkCap)
				const rampedCap = this.rampedDailyCap(
					cappedTarget,
					task.website.createdAt,
				)
				if (todayOnSite >= rampedCap) {
					throw new BadRequestException(
						'Daily site cap reached (warm-up / network limit)',
					)
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
				...(dto.maxYandexVisits !== undefined && {
					maxYandexVisits: dto.maxYandexVisits,
				}),
				...(dto.maxGoogleVisits !== undefined && {
					maxGoogleVisits: dto.maxGoogleVisits,
				}),
				...(dto.useYandex !== undefined && { useYandex: dto.useYandex }),
				...(dto.useGoogle !== undefined && { useGoogle: dto.useGoogle }),
				...(dto.pagesDepthFrom !== undefined && {
					pagesDepthFrom: dto.pagesDepthFrom,
				}),
				...(dto.pagesDepthTo !== undefined && {
					pagesDepthTo: dto.pagesDepthTo,
				}),
				...(dto.pageDurationFrom !== undefined && {
					pageDurationFrom: dto.pageDurationFrom,
				}),
				...(dto.pageDurationTo !== undefined && {
					pageDurationTo: dto.pageDurationTo,
				}),
				...(dto.isActive !== undefined && { isActive: dto.isActive }),
				...(dto.targetUrl !== undefined && {
					targetUrl: dto.targetUrl || null,
				}),
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
		const capacity = Math.max(5, Math.floor((activeCount * 2) / 30))
		this.networkCapCache = { value: capacity, expiresAt: now + 5 * 60 * 1000 }
		return capacity
	}

	// Владельцы с «живыми» купленными баллами — их сайты идут в приоритет выдачи.
	// Приоритет держится, пока купленные баллы не израсходованы. Бесплатные баллы
	// (welcome 1000 + referral + earned + refund + положительный admin) тратятся
	// первыми, купленные — последними (favourable к покупателю):
	//   paidConsumed = max(0, потрачено − бесплатные);  paidRemaining = куплено − paidConsumed
	// Кэш 5 мин — пересчёт по всей балансовой истории недёшев, а набор меняется редко.
	private static readonly WELCOME_BASELINE = 1000 // User.balance @default(1000), без записи в history
	private paidOwnersCache: { value: Set<string>; expiresAt: number } | null =
		null
	private async getPaidPriorityOwners(): Promise<Set<string>> {
		const now = Date.now()
		if (this.paidOwnersCache && this.paidOwnersCache.expiresAt > now) {
			return this.paidOwnersCache.value
		}

		// Только покупатели (есть запись PAYMENT) — остальных считать незачем
		const buyers = await this.prisma.balanceHistory.findMany({
			where: { type: 'PAYMENT' },
			select: { userId: true },
			distinct: ['userId'],
		})
		const buyerIds = buyers.map(b => b.userId)

		const set = new Set<string>()
		if (buyerIds.length > 0) {
			const sums = await this.prisma.balanceHistory.groupBy({
				by: ['userId', 'type'],
				where: { userId: { in: buyerIds } },
				_sum: { amount: true },
			})
			const perUser = new Map<
				string,
				{ purchased: number; free: number; spent: number }
			>()
			for (const row of sums) {
				const acc = perUser.get(row.userId) ?? {
					purchased: 0,
					free: 0,
					spent: 0,
				}
				const amt = row._sum.amount ?? 0
				if (row.type === 'PAYMENT') {
					acc.purchased += amt
				} else if (row.type === 'TASK_SPENT') {
					acc.spent += -amt // TASK_SPENT хранится отрицательным
				} else {
					// WELCOME_BONUS / REFERRAL_BONUS / TASK_EARNED / REFUND / ADMIN_ADJUSTMENT
					if (amt >= 0) acc.free += amt
					else acc.spent += -amt // отрицательная admin-корректировка = списание
				}
				perUser.set(row.userId, acc)
			}
			for (const [uid, acc] of perUser) {
				const free = acc.free + TasksService.WELCOME_BASELINE
				const paidConsumed = Math.max(0, acc.spent - free)
				if (acc.purchased - paidConsumed > 0) set.add(uid)
			}
		}

		this.paidOwnersCache = { value: set, expiresAt: now + 5 * 60 * 1000 }
		return set
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
		return Math.max(
			START_CAP,
			Math.floor(START_CAP + (targetMax - START_CAP) * eased),
		)
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

	// SELECT-only диагностика: объясняет почему доступных задач 0 для данного исполнителя.
	// Базовые счётчики берём из computeAvailability — те же цифры, что и в реальной выдаче.
	async debugAvailability(executorId: string) {
		const cooldownDate = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000)

		const [{ diag }, totalActivePendingTasks, blockedByCooldown15d] =
			await Promise.all([
				this.computeAvailability(executorId),
				this.prisma.task.count({
					where: { isActive: true, keywordStatus: 'ACTIVE', status: 'PENDING' },
				}),
				this.prisma.execution
					.findMany({
						where: {
							executorId,
							status: 'COMPLETED',
							completedAt: { gte: cooldownDate },
						},
						select: { taskId: true },
						distinct: ['taskId'],
					})
					.then(r => r.length),
			])

		return {
			networkCap: diag.networkCap,
			totalActivePendingTasks,
			blockedByNotInSerp: diag.blockedByNotInSerp,
			blockedByCooldown15d,
			blockedByMonthlyLimit: diag.blockedByMonthlyLimit,
			blockedByRecentVisit10d: diag.blockedByRecentVisit10d,
			sitesAtDailyCap: diag.sitesAtDailyCap,
		}
	}
}
