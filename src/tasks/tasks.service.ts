import {
	BadRequestException,
	HttpException,
	HttpStatus,
	Injectable,
	NotFoundException,
} from '@nestjs/common'
import { AppConfigService } from '../app-config/app-config.service'
import { NotificationsService } from '../notifications/notifications.service'
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
	private readonly helpRequestLastSent = new Map<string, number>()

	constructor(
		private prisma: PrismaService,
		private usersService: UsersService,
		private appConfig: AppConfigService,
		private notifications: NotificationsService,
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
		).filter((id): id is string => id !== null)

		// Задачи, где ключевик не найден этим исполнителем — скрываем на 14 дней, затем
		// перепроверяем (позиции меняются, в т.ч. благодаря самому ПФ). Мёртвые ключи
		// и так уходят в keywordStatus=RESTRICTED после 10 подряд NOT_IN_SERP.
		const notInSerpSince = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
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
		const ago30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
		// IN_PROGRESS не старше 2ч — учитываем активные задачи в дневном cap,
		// чтобы при всплеске N исполнителей не превысить rampedDailyCap до COMPLETED.
		const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000)
		// Минимальный зазор для подавления кластеризации визитов (защита от капчи).
		// Используем то же окно: хватит одной записи IN_PROGRESS/COMPLETED за последние 2ч.
		const recentVisitCutoff = twoHoursAgo

		const [todayCountsBySite, foundCountsBySite, lastVisitBySite, recentVisitSiteRows] = await Promise.all([
			this.prisma.execution.groupBy({
				by: ['websiteId'],
				where: {
					websiteId: { in: eligibleSiteIds },
					OR: [
						{ status: 'COMPLETED', completedAt: { gte: dayAgo24h } },
						{ status: 'IN_PROGRESS', createdAt: { gte: twoHoursAgo } },
					],
				},
				_count: { _all: true },
			}),
			// Кол-во «найдено в топе» за последние 30 дней — для приоритизации успешных сайтов
			this.prisma.execution.groupBy({
				by: ['websiteId'],
				where: {
					websiteId: { in: eligibleSiteIds },
					status: 'COMPLETED',
					foundInTop: true,
					completedAt: { gte: ago30d },
				},
				_count: { _all: true },
			}),
			// Дата последнего посещения по сайту — тайбрейкер: давно не посещённые сайты в приоритете
			this.prisma.execution.groupBy({
				by: ['websiteId'],
				where: { websiteId: { in: eligibleSiteIds }, status: 'COMPLETED' },
				_max: { completedAt: true },
			}),
			// Сайты, у которых есть визит от ЛЮБОГО ПК за последние 2ч — исключаем из выдачи,
			// чтобы не кластеризовать визиты (Яндекс видит несколько разных IP за минуты → капча).
			this.prisma.execution.findMany({
				where: {
					websiteId: { in: eligibleSiteIds },
					OR: [
						{ status: 'COMPLETED', completedAt: { gte: recentVisitCutoff } },
						{ status: 'IN_PROGRESS', createdAt: { gte: recentVisitCutoff } },
					],
				},
				select: { websiteId: true },
				distinct: ['websiteId'],
			}),
		])
		const todayCountBySite = new Map(
			todayCountsBySite.map(c => [c.websiteId, c._count._all]),
		)
		const foundCountBySite = new Map(
			foundCountsBySite.map(c => [c.websiteId, c._count._all]),
		)
		const lastVisitMap = new Map(
			lastVisitBySite.map(r => [r.websiteId, r._max.completedAt]),
		)
		const recentlyVisitedSites = new Set(recentVisitSiteRows.map(r => r.websiteId))

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

		// Метаданные сайтов: createdAt (warm-up), override target, владелец (платный приоритет + boost)
		const websiteMeta = await this.prisma.website.findMany({
			where: { id: { in: eligibleSiteIds } },
			select: {
				id: true,
				createdAt: true,
				dailyVisitsTarget: true,
				autoMaxVisits: true,
				userId: true,
				user: { select: { priorityBoost: true } },
			},
		})

		const [paidOwners, pts, executorUser] = await Promise.all([
			this.getPaidPriorityOwners(),
			this.appConfig.getPointsConfig(),
			// Нужен возраст аккаунта исполнителя для адаптивного ratio платных/бесплатных задач.
			// Новые аккаунты получают равное соотношение чтобы не рисковать репутацией платных сайтов
			// (см. логику ниже у блока interleave).
			this.prisma.user.findUnique({ where: { id: executorId }, select: { createdAt: true } }),
		])

		// Для каждого eligible-сайта: остался ли дневной лимит. Закапанные исключаем.
		const siteInfo = new Map<string, { fillRatio: number; isPaid: boolean; foundCount: number; boost: number; daysSinceLastVisit: number }>()
		for (const site of websiteMeta) {
			// autoMaxVisits → всегда крутим по максимуму сети (динамически растёт с парком ПК)
			const userSiteTarget = site.autoMaxVisits
				? networkCap
				: (site.dailyVisitsTarget ?? siteTargetMap.get(site.id) ?? 0)
			const cappedTarget = Math.min(userSiteTarget, networkCap)
			const rampedCap = Math.max(
				1,
				Math.round(
					this.rampedDailyCap(cappedTarget, site.createdAt) *
						this.dailyJitter(site.id),
				),
			)
			const todayOnSite = todayCountBySite.get(site.id) ?? 0
			if (todayOnSite >= rampedCap) continue // сайт упёрся в дневной cap
			if (recentlyVisitedSites.has(site.id)) continue // посещали < 2ч назад — ждём паузу
			const boost = (site.user as any)?.priorityBoost ?? 1
			const lastVisited = lastVisitMap.get(site.id)
			const daysSinceLastVisit = lastVisited
				? Math.floor((Date.now() - lastVisited.getTime()) / (24 * 60 * 60 * 1000))
				: 9999
			siteInfo.set(site.id, {
				// boost > 1 → делим fillRatio, сайт выглядит «менее заполненным» → выше в очереди
				fillRatio: rampedCap > 0 ? (todayOnSite / rampedCap) / Math.max(1, boost) : 1,
				isPaid: paidOwners.has(site.userId),
				foundCount: foundCountBySite.get(site.id) ?? 0,
				boost,
				daysSinceLastVisit,
			})
		}

		const availableSiteIds = Array.from(siteInfo.keys())
		// Сайты, отвалившиеся именно из-за дневного cap (реальный rampedDailyCap, только eligible)
		diag.sitesAtDailyCap = eligibleSiteIds.length - availableSiteIds.length
		if (availableSiteIds.length === 0) return { candidates: [], diag }

		// КРИТ-3: разделяем paid/non-paid ДО take-лимита — иначе новый платный сайт
		// вытесняется 300 более старыми бесплатными задачами и никогда не выдаётся.
		const paidSiteIds = availableSiteIds.filter(id => siteInfo.get(id)?.isPaid)
		const nonPaidSiteIds = availableSiteIds.filter(id => !siteInfo.get(id)?.isPaid)
		const taskQuery = (ids: string[], take: number) =>
			ids.length === 0
				? Promise.resolve([] as typeof allTasks)
				: this.prisma.task.findMany({
						where: {
							...eligibleTaskWhere,
							website: { ...eligibleTaskWhere.website, id: { in: ids } },
						},
						include: { website: { include: { user: true } } },
						orderBy: { createdAt: 'asc' },
						take,
					})
		const [paidTasks, nonPaidTasks] = await Promise.all([
			taskQuery(paidSiteIds, 200),
			taskQuery(nonPaidSiteIds, 100),
		])
		const allTasks = [...paidTasks, ...nonPaidTasks]

		const candidates = []
		for (const task of allTasks) {
			if (task.website.userId === executorId) continue // защита: не свои
			if (task.website.user.balance < this.getTaskOwnerMaxCost(task, pts)) continue
			const info = siteInfo.get(task.websiteId)
			if (!info) continue
			candidates.push({ task, isPaid: info.isPaid, fillRatio: info.fillRatio, foundCount: info.foundCount, boost: info.boost, daysSinceLastVisit: info.daysSinceLastVisit })
		}

		// ─── Сортировка внутри пула ───────────────────────────────────────────────
		// Каждый пул (платные / бесплатные) сортируется независимо по одной логике:
		//   1. foundCount desc  — сайты, которые чаще находят в топе, идут первыми.
		//                         Логика: если сайт реально ранжируется — исполнитель
		//                         скорее всего найдёт его и получит бонус, владелец доволен.
		//   2. fillRatio asc    — среди равных по foundCount выбираем менее "загруженный"
		//                         сегодня (fillRatio = todayOnSite / rampedCap / boost).
		//                         Это балансирует трафик между сайтами.
		//   3. _salt (random)   — тай-брейк при полном равенстве; нужен чтобы несколько
		//                         параллельных исполнителей не получали одну и ту же задачу №1.
		const sortPool = (pool: typeof candidates) => {
			const salted = pool.map(c => ({ ...c, _salt: Math.random() }))
			salted.sort((a, b) => {
				if (a.foundCount !== b.foundCount) return b.foundCount - a.foundCount
				if (a.fillRatio !== b.fillRatio) return a.fillRatio - b.fillRatio
				// тайбрейкер: сайты, которые давно не посещали, получают приоритет
				if (a.daysSinceLastVisit !== b.daysSinceLastVisit) return b.daysSinceLastVisit - a.daysSinceLastVisit
				return a._salt - b._salt
			})
			return salted
		}

		// ─── Адаптивное ratio платных / бесплатных задач ─────────────────────────
		// Проблема: новый аккаунт исполнителя = новый браузерный профиль без истории
		// (куки, паттерны поведения, история поиска). Яндекс и Google смотрят на "зрелость"
		// профиля — свежий аккаунт выглядит подозрительнее и с большей вероятностью
		// получит капчу или пессимизацию сайта-цели.
		//
		// Решение: первые 5 дней новый исполнитель получает задачи 50/50 (платные/бесплатные).
		// Бесплатные сайты — менее критичны, "обкатка" нового профиля на них безопаснее.
		// После 5 дней профиль считается прогретым и переходит на стандартное соотношение 7/3.
		//
		// 5 дней выбрано в соответствии с DAILY_RAMP_UP в Electron-приложении — это тот же
		// период, за который приложение плавно наращивает дневной лимит задач для нового аккаунта.
		const EXECUTOR_WARMUP_DAYS = 5
		const executorAgeDays = executorUser
			? Math.floor((Date.now() - executorUser.createdAt.getTime()) / (24 * 60 * 60 * 1000))
			: EXECUTOR_WARMUP_DAYS // если пользователь не найден — считаем прогретым, не блокируем

		// paidSlots / nonPaidSlots — размер блока при перемежевании:
		//   новый аккаунт (<5д):  5 платных + 5 бесплатных = 50/50
		//   прогретый (≥5д):      7 платных + 3 бесплатных = 70/30
		const [paidSlots, nonPaidSlots] = executorAgeDays < EXECUTOR_WARMUP_DAYS
			? [5, 5]
			: [7, 3]

		// ─── Перемежевание двух пулов ─────────────────────────────────────────────
		// Строгий isPaid-тир (сначала все платные, потом все бесплатные) заменён на
		// блочное смешивание. Это даёт:
		//   - платным клиентам гарантированный приоритет (~70% задач прогретого исполнителя)
		//   - бесплатным ненулевой шанс — они не голодают пока у платных есть задачи
		// Пример при paidSlots=7, nonPaidSlots=3 и 20 платных + 10 бесплатных задачах:
		//   позиции 1-7:  платные #1-7
		//   позиции 8-10: бесплатные #1-3
		//   позиции 11-17: платные #8-14
		//   позиции 18-20: бесплатные #4-6
		//   позиции 21-27: платные #15-20 (меньше 7 — добираем сколько есть)
		//   позиции 28-30: бесплатные #7-10
		const paidPool = sortPool(candidates.filter(c => c.isPaid))
		const nonPaidPool = sortPool(candidates.filter(c => !c.isPaid))
		const merged: typeof paidPool = []
		let pi = 0, ni = 0

		// Фаза 1 — перемежевание пока оба пула непусты.
		// Чередуем блоки: paidSlots платных, nonPaidSlots бесплатных, и так по кругу.
		while (pi < paidPool.length && ni < nonPaidPool.length) {
			for (let i = 0; i < paidSlots && pi < paidPool.length; i++, pi++) merged.push(paidPool[pi])
			for (let i = 0; i < nonPaidSlots && ni < nonPaidPool.length; i++, ni++) merged.push(nonPaidPool[ni])
		}

		// Фаза 2 — дренаж остатка.
		// Если один из пулов кончился раньше — второй добавляется целиком без ограничений.
		// Пример: платных задач нет совсем → исполнитель получает только бесплатные,
		// без пустых "слотов" и задержек. И наоборот — если бесплатных нет, платные заполняют всё.
		while (pi < paidPool.length) merged.push(paidPool[pi++])
		while (ni < nonPaidPool.length) merged.push(nonPaidPool[ni++])

		return { candidates: merged, diag }
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
		// M1: грузим pts ДО транзакции — cost guard должен использовать актуальный foundSpent из AppConfig
		const pts = await this.appConfig.getPointsConfig()
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
				// C4: включаем IN_PROGRESS (≤2ч) — иначе при всплеске N исполнителей
				// все видят todayOnSite=0 и разбирают задачи сверх rampedDailyCap.
				const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000)
				const todayOnSite = await prisma.execution.count({
					where: {
						websiteId: task.websiteId,
						OR: [
							{ status: 'COMPLETED', completedAt: { gte: dayAgo24h } },
							{ status: 'IN_PROGRESS', createdAt: { gte: twoHoursAgo } },
						],
					},
				})
				const networkCap = await this.getNetworkPerSiteCapacity()
				// Site target: autoMaxVisits → максимум сети (динамически); иначе явный
				// override website.dailyVisitsTarget или сумма target'ов ключей.
				const userSiteTarget = task.website.autoMaxVisits
					? networkCap
					: (task.website.dailyVisitsTarget ??
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
						})()))
				const cappedTarget = Math.min(userSiteTarget, networkCap)
				const rampedCap = Math.max(
					1,
					Math.round(
						this.rampedDailyCap(cappedTarget, task.website.createdAt) *
							this.dailyJitter(task.websiteId),
					),
				)
				if (todayOnSite >= rampedCap) {
					throw new BadRequestException(
						'Daily site cap reached (warm-up / network limit)',
					)
				}

				if (task.website.user.balance < this.getTaskOwnerMaxCost(task, pts)) {
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

	// Потолок просмотров в день на ОДИН сайт = то, что видит и выбирает владелец.
	// Единая формула в AppConfigService: ceil(среднее активных ПК в день за неделю
	// / 14) — один ПК повторяет визит на сайт не чаще раза в 2 недели, значит в
	// любой день «свежи» лишь 1/14 парка. То же число показывается в форме создания
	// сайта и в админке (единый источник правды).
	private async getNetworkPerSiteCapacity(): Promise<number> {
		const { maxPerDay } = await this.appConfig.getNetworkCapacityInfo()
		return maxPerDay
	}

	// Дневной разброс ±10%, чтобы выдача не была каждый день ровно равна потолку.
	// Детерминирован по (сайт + календарный день) — стабилен в течение суток, иначе
	// при каждом запросе доступности cap бы «прыгал» и todayOnSite≷cap мерцал.
	private dailyJitter(siteId: string): number {
		const day = Math.floor(Date.now() / (24 * 60 * 60 * 1000))
		let h = 2166136261
		const s = `${siteId}:${day}`
		for (let i = 0; i < s.length; i++) {
			h ^= s.charCodeAt(i)
			h = Math.imul(h, 16777619)
		}
		const frac = ((h >>> 0) % 1000) / 1000 // 0..0.999
		return 0.9 + frac * 0.2 // 0.9 .. 1.1
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

	private getTaskOwnerMaxCost(
		task: { type: string; useYandex?: boolean | null; useGoogle?: boolean | null },
		pts: { foundSpent: number } = { foundSpent: 30 },
	) {
		if (task.type === 'EXTERNAL_LINK') {
			return 10
		}

		const enabledEngines =
			(task.useYandex !== false ? 1 : 0) + (task.useGoogle !== false ? 1 : 0)

		return Math.max(1, enabledEngines) * pts.foundSpent
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

	async sendHelpRequest(userId: string): Promise<{ success: true; nextAllowedIn?: never }> {
		const COOLDOWN_MS = 30_000
		const now = Date.now()
		const last = this.helpRequestLastSent.get(userId) ?? 0
		if (now - last < COOLDOWN_MS) {
			const waitSec = Math.ceil((COOLDOWN_MS - (now - last)) / 1000)
			throw new HttpException(
				`Слишком частые запросы. Подождите ${waitSec} сек.`,
				HttpStatus.TOO_MANY_REQUESTS,
			)
		}
		this.helpRequestLastSent.set(userId, now)

		const user = await this.prisma.user.findUnique({
			where: { id: userId },
			select: { email: true },
		})
		const websites = await this.prisma.website.findMany({
			where: { userId },
			select: { url: true, name: true },
			take: 5,
		})
		const siteList = websites.length
			? websites.map(w => `• ${w.name || w.url} (${w.url})`).join('\n')
			: '— сайты не добавлены —'

		const adminEmail = process.env.ADMIN_EMAIL || 'gorlach7v@gmail.com'

		await Promise.all([
			// Уведомление администратору
			this.notifications.sendRawEmail(
				adminEmail,
				`SkySEO: запрос помощи от ${user.email}`,
				`Пользователь ${user.email} запросил помощь менеджера.\n\nСайты:\n${siteList}\n\nВремя: ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}`,
			),
			// Подтверждение пользователю
			this.notifications.sendRawEmail(
				user.email,
				'SkySEO: ваша заявка принята',
				`Здравствуйте!\n\nМы получили вашу заявку и свяжемся с вами в ближайшее время.\nНаш менеджер поможет подобрать ключевые слова и настроить сайт.\n\nВы также можете написать нам напрямую: @skyseo_support\n\nС уважением,\nКоманда SkySEO`,
			),
		])

		return { success: true }
	}
}
