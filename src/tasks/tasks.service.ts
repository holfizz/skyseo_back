/**
 * ⚠️  ПЕРЕД ИЗМЕНЕНИЕМ ЭТОГО ФАЙЛА — ПРОЧИТАЙ ДОКУМЕНТАЦИЮ ДВИЖКА: skyseo_app/ENGINE.md
 *     (документация лежит в репозитории Electron-приложения и описывает движок целиком: бэк + клиент)
 *
 *     Профильный раздел: §4 «Бэкенд: алгоритм выдачи задач» + §5 «Формулы и константы»
 *
 *     Файл — часть движка выдачи задач и работы с поисковой выдачей. В движке много
 *     неочевидных связей: лимиты, кулдауны, антифрод-логика, договорённости между
 *     бэкендом и Electron-приложением. Правка «по месту» почти всегда ломает что-то
 *     на другом конце цепочки. Сначала прочитай контекст — потом меняй код.
 *
 *     Отдельно: §13.0 документации перечисляет поведение, которое ВЫГЛЯДИТ багом,
 *     но является осознанным решением. Не «чини» его без обсуждения.
 */

import {
	BadRequestException,
	HttpException,
	HttpStatus,
	Injectable,
	NotFoundException,
} from '@nestjs/common'
import { AppConfigService } from '../app-config/app-config.service'
import { maybeStartTrial } from '../common/trial'
import { NotificationsService } from '../notifications/notifications.service'
import { PrismaService } from '../prisma/prisma.service'
import { TelegramService } from '../telegram/telegram.service'
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
		private telegram: TelegramService,
	) {}

	async create(userId: string, dto: CreateTaskDto, isApp = false) {
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

		// Триал (нет покупок): максимум 5 ключевых слов на сайт (только веб).
		const hasPaid =
			(await this.prisma.payment.count({
				where: { userId, status: 'SUCCEEDED' },
			})) > 0
		if (!isApp && !hasPaid && keywordCount >= 5) {
			throw new BadRequestException(
				'На бесплатном тарифе можно добавить до 5 ключевых слов. Пополните баланс, чтобы снять ограничение.',
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

		// Бесплатная неделя стартует по позднему из двух событий: первый ключ и
		// одобрение сайта. Здесь срабатывает случай «сайт уже одобрен, добавили ключ».
		await maybeStartTrial(this.prisma, userId)

		return task
	}

	async getAvailableTasks(executorId: string, limit: number = 10) {
		const safeLimit = Math.max(1, Math.min(limit, 100))
		const { candidates } = await this.computeAvailability(executorId)

		let items = candidates.slice(0, safeLimit).map(({ task }) => this.toQueueItem(task))

		// Принудительная очередь: передний пин (если есть и подходит этому ПК) — в самое начало.
		const pinnedTask = await this.resolveFrontPinTask(executorId, candidates)
		if (pinnedTask) {
			items = items.filter(i => i.id !== pinnedTask.id)
			items.unshift(this.toQueueItem(pinnedTask))
			items = items.slice(0, safeLimit)
		}
		return items
	}

	private toQueueItem(task: any) {
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
			// Режим рекламы в выдаче; старое приложение поле просто игнорирует
			adPolicy: task.website.adPolicy ?? 'EXCLUDE',
			createdAt: task.createdAt,
			alreadyCompleted: false,
			remainingExecutions: 1,
		}
	}

	// Передний непотраченный пин, подходящий этому ПК. force=true → инжект (обход фильтров);
	// force=false → бампим только если ПК и так имеет право на задание (оно есть в candidates).
	// Пины перебираем по position; непригодный для этого ПК пропускаем (не блокируем очередь).
	private async resolveFrontPinTask(
		executorId: string,
		candidates: Array<{ task: any }>,
	): Promise<any | null> {
		const pins = await this.prisma.pinnedTask.findMany({
			where: { consumedAt: null },
			orderBy: { position: 'asc' },
			take: 20,
			include: { task: { include: { website: true } } },
		})
		const now = Date.now()
		for (const pin of pins) {
			const task: any = pin.task
			if (!task || !task.isActive || task.status !== 'PENDING' || task.keywordStatus !== 'ACTIVE') continue
			if (!task.website || !task.website.isActive || !task.website.isApproved) continue
			if (task.website.userId === executorId) continue // не свой сайт
			// Мягкий таргет: пока окно активно — пин только назначенному ПК; после окна — общий.
			const targetedActive =
				!!pin.targetExecutorId && !!pin.targetUntilAt && pin.targetUntilAt.getTime() > now
			if (targetedActive && pin.targetExecutorId !== executorId) continue
			if (pin.force) return task
			const eligible = candidates.find(c => c.task.id === task.id)
			if (eligible) return eligible.task
		}
		return null
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

		// Ключи, которые ЭТОТ ПК не находит в выдаче (NOT_IN_SERP), выдаём реже тех, что он
		// находит. Градация по числу неудач за 60 дней у этого исполнителя:
		//   • 1–2 неудачи → прячем на 14 дней, потом перепроверяем (позиции меняются, в т.ч. от самого ПФ);
		//   • >2 неудачи  → прячем на 45 дней (выдаётся заметно реже найденных ключей).
		// Мёртвые ключи и так уходят в keywordStatus=RESTRICTED после 10 подряд NOT_IN_SERP (глобально).
		const failLookback = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)
		// Сеть маленькая — переоткрываем ключ тому же ПК быстро: 3 дня (1–2 промаха),
		// 5 дней (3+ промаха). Позиции волатильны, ждать 2 недели смысла нет.
		const LIGHT_HIDE_MS = 3 * 24 * 60 * 60 * 1000
		const HEAVY_HIDE_MS = 5 * 24 * 60 * 60 * 1000
		const nowMs = Date.now()
		const notInSerpStats = await this.prisma.execution.groupBy({
			by: ['taskId'],
			where: {
				executorId,
				status: 'FAILED',
				failureReason: 'NOT_IN_SERP',
				completedAt: { gte: failLookback },
			},
			_count: { _all: true },
			_max: { completedAt: true },
		})
		const notInSerpTaskIds = notInSerpStats
			.filter(s => {
				const lastFail = s._max.completedAt?.getTime() ?? 0
				const hideMs = s._count._all > 2 ? HEAVY_HIDE_MS : LIGHT_HIDE_MS
				return nowMs - lastFail < hideMs
			})
			.map(s => s.taskId)
			.filter((id): id is string => id !== null)

		// Задача, которая только что не выполнилась (не досталось браузера — LOCK_TIMEOUT, или
		// не нашли сайт — NOT_IN_SERP), возвращается в НАЧАЛО очереди, чтобы её сразу подхватил
		// ДРУГОЙ ПК (сам «провинившийся» ПК исключается ниже, см. eligibleTaskWhere).
		// Кап ≤3 за 30 мин — чтобы «ядовитая» задача, которая всегда падает, не застряла в начале
		// и не морила остальную очередь.
		const recentFailCutoff = new Date(Date.now() - 30 * 60 * 1000)
		const recentFailStats = await this.prisma.execution.groupBy({
			by: ['taskId'],
			where: {
				status: 'FAILED',
				failureReason: { in: ['LOCK_TIMEOUT', 'NOT_IN_SERP'] },
				completedAt: { gte: recentFailCutoff },
			},
			_count: { _all: true },
		})
		const retryFrontTaskIds = new Set(
			recentFailStats
				.filter(s => s._count._all <= 3)
				.map(s => s.taskId)
				.filter((id): id is string => id !== null),
		)

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
					OR: [
						{ status: 'COMPLETED' as const, completedAt: { gte: cooldownDate } },
						// «Не тому же ПК»: задачу, которую этот ПК только что завалил, 30 мин ему не
						// отдаём — пусть подхватит другой (она в начале очереди). Окно, а не навсегда:
						// в крошечной сети из одного ПК иначе задача застряла бы насовсем.
						{ status: 'FAILED' as const, completedAt: { gte: recentFailCutoff } },
					],
				},
			},
			website: {
				isActive: true,
				isApproved: true,
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
						// Дневной лимит съедают только УСПЕШНЫЕ визиты — сайт нашли в выдаче
						// и зашли на него. Неудачная попытка квоту не тратит: ПК продолжают
						// работать по этому сайту, пока не наберётся нужное число успехов.
						{ status: 'COMPLETED', foundInTop: true, completedAt: { gte: dayAgo24h } },
						// IN_PROGRESS — бронь: исход ещё неизвестен. Без неё при всплеске
						// исполнителей все увидят todayOnSite=0 и разберут задачи сверх лимита
						// (ENGINE.md §4, шаг 4).
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

		// Возраст исполнителя и список платных владельцев больше не нужны: пул единый,
		// приоритезировать нечего — в очередь и так попадают только оплаченные сайты.
		const pts = await this.appConfig.getPointsConfig()

		// Для каждого eligible-сайта: остался ли дневной лимит. Закапанные исключаем.
		const siteInfo = new Map<string, { fillRatio: number; foundCount: number; boost: number; daysSinceLastVisit: number }>()
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
				foundCount: foundCountBySite.get(site.id) ?? 0,
				boost,
				daysSinceLastVisit,
			})
		}

		const availableSiteIds = Array.from(siteInfo.keys())
		// Сайты, отвалившиеся именно из-за дневного cap (реальный rampedDailyCap, только eligible)
		diag.sitesAtDailyCap = eligibleSiteIds.length - availableSiteIds.length
		if (availableSiteIds.length === 0) return { candidates: [], diag }

		// Единый пул: раньше здесь резались отдельные take-лимиты для платных и
		// бесплатных, чтобы новый платный сайт не вытеснялся сотнями старых бесплатных.
		// Теперь в выдачу попадают только сайты с действующей подпиской, пул однородный,
		// и делить его не от чего — берём одним запросом.
		const allTasks =
			availableSiteIds.length === 0
				? []
				: await this.prisma.task.findMany({
						where: {
							...eligibleTaskWhere,
							website: { ...eligibleTaskWhere.website, id: { in: availableSiteIds } },
						},
						include: { website: { include: { user: true } } },
						orderBy: { createdAt: 'asc' },
						take: 300,
					})

		const candidates = []
		for (const task of allTasks) {
			if (task.website.userId === executorId) continue // защита: не свои
			// Продвижение снова оплачивается баллами владельца, как в приложении.
			// Гейт по подписке (paidUntil) убран: у всех живых аккаунтов дата пуста,
			// и очередь становилась пустой для всей сети. Дни подписки остаются
			// отдельным полем для веб-кабинета и ничего здесь не решают.
			if (task.website.user.balance < this.getTaskOwnerMaxCost(task, pts)) continue
			const info = siteInfo.get(task.websiteId)
			if (!info) continue
			candidates.push({ task, fillRatio: info.fillRatio, foundCount: info.foundCount, boost: info.boost, daysSinceLastVisit: info.daysSinceLastVisit })
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
			const salted = pool.map(c => ({ ...c, _salt: Math.random(), _retry: retryFrontTaskIds.has(c.task.id) ? 1 : 0 }))
			salted.sort((a, b) => {
				// ретрай после LOCK_TIMEOUT (не досталось свободного ПК) — в начало очереди
				if (a._retry !== b._retry) return b._retry - a._retry
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
		// ─── Единый пул ───────────────────────────────────────────────────────────
		// Деления на платных и бесплатных больше НЕТ. Продвижение теперь возможно
		// только при действующей подписке (users.paidUntil), а бесплатная неделя —
		// это та же подписка, просто выданная платформой. То есть в очередь и так
		// попадают только «платные» сайты, и приоритезировать одних над другими
		// стало нечего: перемежевание 70/30 делило бы однородный пул.
		//
		// Заменяет прежний блочный микс paidSlots/nonPaidSlots (ENGINE.md §4, шаг 6).
		// Порядок внутри пула по-прежнему задаёт sortPool: ретраи, найденные в топе,
		// менее загруженные, давно не посещённые, затем random.
		return { candidates: sortPool(candidates), diag }
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

				// Принудительный пин с force=true обходит все кулдауны/лимиты ниже (любой ПК может взять).
				const pin = await prisma.pinnedTask.findFirst({
					where: { taskId, consumedAt: null },
					orderBy: { position: 'asc' },
				})
				const forced = pin?.force === true

				if (!forced) {
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
							// Только успешные визиты съедают дневную квоту — см. тот же
							// фильтр в computeAvailability. Неудачи ПК продолжают отрабатывать.
							{ status: 'COMPLETED', foundInTop: true, completedAt: { gte: dayAgo24h } },
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
				}

				// Гейт баланса. Стоит СНАРУЖИ `if (!forced)`, то есть force-пин его не
				// обходит. Это единственная защита прямого POST /tasks/:id/assign: выше
				// по коду не проверяются ни isActive, ни keywordStatus, ни isApproved —
				// только status === 'PENDING'.
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

				// Пин «сгорает»: задание успешно взято этим ПК (клейм задачи уже сериализован по PENDING).
				if (pin) {
					await prisma.pinnedTask.updateMany({
						where: { id: pin.id, consumedAt: null },
						data: { consumedAt: new Date(), consumedByExecutorId: executorId },
					})
				}

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
		// Baseline для уведомлений о росте: первая известная позиция запоминается без письма,
		// дальше письмо шлётся только при выходе на новый рекорд (см. executions.service).
		if (yandexPosition != null) {
			await this.prisma.task.updateMany({
				where: { id: taskId, notifiedBestPosition: null },
				data: { notifiedBestPosition: yandexPosition },
			})
		}

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

	// Сколько визитов в день доступно каждому активному сайту пользователя СЕГОДНЯ
	// с учётом плавного разгона (rampedDailyCap) и потолка сети. Та же формула, что в
	// computeAvailability, но без суточного jitter — для честного показа в кабинете.
	async getDailyAvailabilityForUser(userId: string): Promise<Map<string, number>> {
		const sites = await this.prisma.website.findMany({
			where: { userId, isActive: true },
			select: {
				id: true,
				createdAt: true,
				dailyVisitsTarget: true,
				autoMaxVisits: true,
			},
		})
		if (sites.length === 0) return new Map()

		const networkCap = await this.getNetworkPerSiteCapacity()
		const siteIds = sites.map(s => s.id)
		const tasks = await this.prisma.task.findMany({
			where: { websiteId: { in: siteIds }, isActive: true, keywordStatus: 'ACTIVE' },
			select: {
				websiteId: true,
				type: true,
				maxYandexVisits: true,
				maxGoogleVisits: true,
				useYandex: true,
				useGoogle: true,
			},
		})
		const targetMap = new Map<string, number>()
		for (const t of tasks) {
			targetMap.set(
				t.websiteId,
				(targetMap.get(t.websiteId) ?? 0) + this.getTaskDailyTarget(t),
			)
		}

		const out = new Map<string, number>()
		for (const s of sites) {
			const userSiteTarget = s.autoMaxVisits
				? networkCap
				: (s.dailyVisitsTarget ?? targetMap.get(s.id) ?? 0)
			const cappedTarget = Math.min(userSiteTarget, networkCap)
			out.set(s.id, Math.round(this.rampedDailyCap(cappedTarget, s.createdAt)))
		}
		return out
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

	async reportRestrictedKeyword(userId: string, taskId: string, message: string, telegram?: string) {
		const task = await this.prisma.task.findFirst({
			where: { id: taskId, website: { userId } },
			include: { website: true },
		})
		if (!task) throw new NotFoundException('Задача не найдена')

		const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true } })

		await this.telegram.sendRestrictedKeywordReport({
			userEmail: user?.email ?? 'неизвестно',
			keyword: task.keyword,
			websiteUrl: task.website.url,
			message: message?.trim() || '',
			telegram: telegram?.trim() || '',
		})

		return { success: true }
	}
}
