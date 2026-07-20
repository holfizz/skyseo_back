import { Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { loadExecutionTrace } from '../common/execution-trace'
import { PrismaService } from '../prisma/prisma.service'

export type Health = 'ok' | 'warn' | 'bad' | 'idle'

const DAY = 24 * 60 * 60 * 1000
const MSK_OFFSET = 3 * 60 * 60 * 1000 // дни графика режем по московскому времени

// Порядок сортировки списка клиентов: проблемные — наверх.
const HEALTH_ORDER: Record<Health, number> = { bad: 0, warn: 1, ok: 2, idle: 3 }

const FAILURE_LABELS: Record<string, string> = {
	CAPTCHA: 'Капча в поиске',
	SCRIPT_ERROR: 'Сбой в приложении',
	NOT_IN_SERP: 'Сайт не найден в выдаче',
	LOCK_TIMEOUT: 'Не дождались свободного ПК',
}

function plural(n: number, one: string, few: string, many: string): string {
	const m10 = n % 10
	const m100 = n % 100
	if (m10 === 1 && m100 !== 11) return one
	if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few
	return many
}

// Ключ дня 'YYYY-MM-DD' по МСК — и для SQL-бакетов, и для генерации 30 точек графика.
function mskDayKey(d: Date): string {
	return new Date(d.getTime() + MSK_OFFSET).toISOString().slice(0, 10)
}

// Сырые счётчики выполнений, из которых считается и health клиента, и статус ключевика.
type Counters = {
	visits7d: number
	visits30d: number
	attempts7d: number
	failed7d: number
	found7d: number
	notFound7d: number
	lastVisitAt: Date | null
}

const EMPTY_COUNTERS: Counters = {
	visits7d: 0, visits30d: 0, attempts7d: 0, failed7d: 0, found7d: 0, notFound7d: 0, lastVisitAt: null,
}

@Injectable()
export class ManagerService {
	constructor(private prisma: PrismaService) {}

	private successRate(visits7d: number, attempts7d: number): number {
		if (!attempts7d) return 0
		return Math.round((visits7d / attempts7d) * 100)
	}

	// Ядро фичи: «работает клиент или нет». Порядок проверок важен — срабатывает первое правило.
	private computeHealth(
		c: Counters,
		activeKeywords: number,
		hasApprovedSite: boolean,
	): { health: Health; healthReason: string } {
		if (activeKeywords === 0) return { health: 'idle', healthReason: 'Нет активных запросов' }
		if (!hasApprovedSite) return { health: 'idle', healthReason: 'Сайт ещё не одобрен' }
		if (c.visits7d === 0) return { health: 'bad', healthReason: 'Визитов нет 7 дней' }
		if (c.found7d === 0 && c.attempts7d > 0) return { health: 'bad', healthReason: 'Сайт не находится в выдаче' }
		const rate = this.successRate(c.visits7d, c.attempts7d)
		if (rate < 40) return { health: 'warn', healthReason: `Мало результативных визитов: ${rate}%` }
		if (c.failed7d > 0 && c.notFound7d / c.failed7d > 0.5) {
			return { health: 'warn', healthReason: 'Половина запросов не находит сайт' }
		}
		return { health: 'ok', healthReason: 'Всё работает' }
	}

	private computeKeywordStatus(
		c: Counters,
		isActive: boolean,
		keywordStatus: string,
	): { status: Health; statusReason: string } {
		if (!isActive || keywordStatus === 'RESTRICTED') {
			return { status: 'idle', statusReason: isActive ? 'Запрос заблокирован' : 'Запрос выключен' }
		}
		// «Вне топ-50» — только когда падения действительно из-за NOT_IN_SERP.
		// Иначе визитов нет по другой причине (LOCK_TIMEOUT, капча, сбой) — не врём про выдачу.
		if (c.attempts7d > 0 && c.notFound7d / c.attempts7d > 0.7) {
			return { status: 'bad', statusReason: 'Не находится в выдаче — сайт вне топ-50' }
		}
		if (c.attempts7d > 0 && c.visits7d === 0) {
			return { status: 'bad', statusReason: 'Визитов нет — попытки падают' }
		}
		if (c.visits7d > 0 && c.notFound7d > 0) {
			return { status: 'warn', statusReason: 'Находится через раз' }
		}
		if (c.attempts7d === 0) return { status: 'idle', statusReason: 'Задач по ключу не было' }
		return { status: 'ok', statusReason: 'Работает' }
	}

	// ——— Список клиентов ———

	async listClients() {
		const now = Date.now()
		const d7 = new Date(now - 7 * DAY)
		const d30 = new Date(now - 30 * DAY)

		const [users, activeTasks, paid, metrics] = await Promise.all([
			// Клиент = пользователь, у которого есть хотя бы один сайт. Роль не важна.
			this.prisma.user.findMany({
				where: { websites: { some: {} } },
				select: {
					id: true,
					email: true,
					telegramContact: true,
					createdAt: true,
					balance: true,
					websites: { select: { id: true, isApproved: true } },
				},
			}),
			this.prisma.task.groupBy({
				by: ['websiteId'],
				where: { isActive: true, keywordStatus: 'ACTIVE' },
				_count: { _all: true },
			}),
			this.prisma.payment.groupBy({
				by: ['userId'],
				where: { status: 'SUCCEEDED' },
				_sum: { amount: true },
			}),
			// Одним проходом по executions собираем все метрики в разрезе сайта.
			// JOIN через tasks, а не через nullable executions."websiteId" — у старых записей он пустой.
			// Границы окон — через FILTER, поэтому lastVisitAt остаётся честным (без ограничения по дате).
			this.prisma.$queryRaw<Array<{
				website_id: string
				visits_7d: bigint
				visits_30d: bigint
				attempts_7d: bigint
				failed_7d: bigint
				found_7d: bigint
				not_found_7d: bigint
				last_visit_at: Date | null
			}>>`
				SELECT
					t."websiteId" AS website_id,
					COUNT(*) FILTER (WHERE e.status = 'COMPLETED' AND e."targetVisited" = true AND e."createdAt" >= ${d7})  AS visits_7d,
					COUNT(*) FILTER (WHERE e.status = 'COMPLETED' AND e."targetVisited" = true AND e."createdAt" >= ${d30}) AS visits_30d,
					COUNT(*) FILTER (WHERE e."createdAt" >= ${d7})                                                          AS attempts_7d,
					COUNT(*) FILTER (WHERE e."createdAt" >= ${d7} AND e.status = 'FAILED')                                  AS failed_7d,
					COUNT(*) FILTER (WHERE e."createdAt" >= ${d7} AND (e."yandexFoundInTop" = true OR e."googleFoundInTop" = true)) AS found_7d,
					COUNT(*) FILTER (WHERE e."createdAt" >= ${d7} AND e."failureReason" = 'NOT_IN_SERP')                    AS not_found_7d,
					MAX(e."completedAt") FILTER (WHERE e.status = 'COMPLETED' AND e."targetVisited" = true)                 AS last_visit_at
				FROM executions e
				JOIN tasks t ON t.id = e."taskId"
				WHERE e.status IN ('COMPLETED', 'FAILED')
				GROUP BY t."websiteId"
			`,
		])

		const activeByWebsite = new Map(activeTasks.map(t => [t.websiteId, t._count._all]))
		const paidByUser = new Map(paid.map(p => [p.userId, Number(p._sum.amount ?? 0)]))
		const metricsByWebsite = new Map(metrics.map(m => [m.website_id, m]))

		const rows = users.map(u => {
			const c: Counters = { ...EMPTY_COUNTERS }
			let activeKeywords = 0
			let hasApprovedSite = false
			for (const w of u.websites) {
				if (w.isApproved) hasApprovedSite = true
				activeKeywords += activeByWebsite.get(w.id) ?? 0
				const m = metricsByWebsite.get(w.id)
				if (!m) continue
				c.visits7d += Number(m.visits_7d)
				c.visits30d += Number(m.visits_30d)
				c.attempts7d += Number(m.attempts_7d)
				c.failed7d += Number(m.failed_7d)
				c.found7d += Number(m.found_7d)
				c.notFound7d += Number(m.not_found_7d)
				if (m.last_visit_at && (!c.lastVisitAt || m.last_visit_at > c.lastVisitAt)) {
					c.lastVisitAt = m.last_visit_at
				}
			}

			const { health, healthReason } = this.computeHealth(c, activeKeywords, hasApprovedSite)
			return {
				id: u.id,
				email: u.email,
				telegramContact: u.telegramContact,
				createdAt: u.createdAt,
				sitesCount: u.websites.length,
				activeKeywords,
				visits7d: c.visits7d,
				visits30d: c.visits30d,
				lastVisitAt: c.lastVisitAt,
				attempts7d: c.attempts7d,
				successRate7d: this.successRate(c.visits7d, c.attempts7d),
				health,
				healthReason,
				balance: u.balance,
				paidTotal: paidByUser.get(u.id) ?? 0,
			}
		})

		rows.sort((a, b) =>
			HEALTH_ORDER[a.health] - HEALTH_ORDER[b.health] || b.visits7d - a.visits7d,
		)
		return rows
	}

	// ——— Карточка клиента ———

	async getClient(id: string) {
		const user = await this.prisma.user.findUnique({
			where: { id },
			select: {
				id: true, email: true, telegramContact: true, city: true, createdAt: true,
				balance: true, appStatus: true, lastSeenAt: true, isActive: true,
				websites: {
					orderBy: { createdAt: 'asc' },
					select: {
						id: true, name: true, url: true, isActive: true, isApproved: true,
						isRestricted: true, dailyVisitsTarget: true, autoMaxVisits: true, createdAt: true,
						tasks: {
							orderBy: { createdAt: 'asc' },
							select: {
								id: true, keyword: true, geo: true, isActive: true, keywordStatus: true,
								useYandex: true, useGoogle: true, maxYandexVisits: true, maxGoogleVisits: true,
								positionHistory: {
									orderBy: { date: 'desc' },
									take: 1,
									select: { yandexPosition: true, googlePosition: true, date: true },
								},
							},
						},
					},
				},
			},
		})
		// Клиент = пользователь с сайтами. Без этой проверки менеджер вытянул бы
		// почту/баланс любого юзера по id — в listClients такое сужение уже есть.
		if (!user || user.websites.length === 0) {
			throw new NotFoundException('Клиент не найден')
		}

		const paidAgg = await this.prisma.payment.aggregate({
			where: { userId: id, status: 'SUCCEEDED' },
			_sum: { amount: true },
		})
		const client = {
			id: user.id,
			email: user.email,
			telegramContact: user.telegramContact,
			city: user.city,
			createdAt: user.createdAt,
			balance: user.balance,
			appStatus: user.appStatus,
			lastSeenAt: user.lastSeenAt,
			paidTotal: Number(paidAgg._sum.amount ?? 0),
			isActive: user.isActive,
		}

		const siteIds = user.websites.map(w => w.id)
		if (siteIds.length === 0) {
			return {
				client,
				summary: { health: 'idle' as Health, text: 'У клиента нет сайтов.', issues: [] as string[] },
				totals: { visits7d: 0, visits30d: 0, attempts7d: 0, failed7d: 0, successRate7d: 0, found7d: 0, notFound7d: 0 },
				chart: this.buildChart([]),
				failures7d: [] as Array<{ reason: string; label: string; count: number }>,
				sites: [] as unknown[],
			}
		}

		const now = Date.now()
		const d7 = new Date(now - 7 * DAY)
		const d30 = new Date(now - 30 * DAY)
		const sites = Prisma.join(siteIds)
		// Начало самого раннего дня графика по МСК (30 точек, включая сегодня).
		const chartFrom = new Date(new Date(mskDayKey(new Date(now - 29 * DAY)) + 'T00:00:00.000Z').getTime() - MSK_OFFSET)

		const [taskMetrics, chartRows, failureGroups] = await Promise.all([
			// Метрики в разрезе ключевика. Запрос ограничен сайтами клиента, поэтому дешёвый;
			// окна режем через FILTER, lastVisitAt берём без ограничения по дате.
			this.prisma.$queryRaw<Array<{
				task_id: string
				visits_7d: bigint
				visits_30d: bigint
				attempts_7d: bigint
				failed_7d: bigint
				found_7d: bigint
				not_found_7d: bigint
				last_visit_at: Date | null
			}>>`
				SELECT
					e."taskId" AS task_id,
					COUNT(*) FILTER (WHERE e.status = 'COMPLETED' AND e."targetVisited" = true AND e."createdAt" >= ${d7})  AS visits_7d,
					COUNT(*) FILTER (WHERE e.status = 'COMPLETED' AND e."targetVisited" = true AND e."createdAt" >= ${d30}) AS visits_30d,
					COUNT(*) FILTER (WHERE e."createdAt" >= ${d7})                                                          AS attempts_7d,
					COUNT(*) FILTER (WHERE e."createdAt" >= ${d7} AND e.status = 'FAILED')                                  AS failed_7d,
					COUNT(*) FILTER (WHERE e."createdAt" >= ${d7} AND (e."yandexFoundInTop" = true OR e."googleFoundInTop" = true)) AS found_7d,
					COUNT(*) FILTER (WHERE e."createdAt" >= ${d7} AND e."failureReason" = 'NOT_IN_SERP')                    AS not_found_7d,
					MAX(e."completedAt") FILTER (WHERE e.status = 'COMPLETED' AND e."targetVisited" = true)                 AS last_visit_at
				FROM executions e
				JOIN tasks t ON t.id = e."taskId"
				WHERE t."websiteId" IN (${sites})
					AND e.status IN ('COMPLETED', 'FAILED')
				GROUP BY e."taskId"
			`,
			this.prisma.$queryRaw<Array<{ d: string; visits: bigint; attempts: bigint; failed: bigint }>>`
				SELECT
					to_char(e."createdAt" + interval '3 hours', 'YYYY-MM-DD') AS d,
					COUNT(*) FILTER (WHERE e.status = 'COMPLETED' AND e."targetVisited" = true) AS visits,
					COUNT(*)                                                                   AS attempts,
					COUNT(*) FILTER (WHERE e.status = 'FAILED')                                 AS failed
				FROM executions e
				JOIN tasks t ON t.id = e."taskId"
				WHERE t."websiteId" IN (${sites})
					AND e.status IN ('COMPLETED', 'FAILED')
					AND e."createdAt" >= ${chartFrom}
				GROUP BY 1
			`,
			this.prisma.execution.groupBy({
				by: ['failureReason'],
				where: {
					task: { websiteId: { in: siteIds } },
					createdAt: { gte: d7 },
					failureReason: { not: null },
				},
				_count: { _all: true },
			}),
		])

		const metricsByTask = new Map(taskMetrics.map(m => [m.task_id, m]))
		const totals = { ...EMPTY_COUNTERS }

		const sitesOut = user.websites.map(w => {
			let siteVisits7d = 0
			const keywords = w.tasks.map(t => {
				const m = metricsByTask.get(t.id)
				const c: Counters = m
					? {
							visits7d: Number(m.visits_7d),
							visits30d: Number(m.visits_30d),
							attempts7d: Number(m.attempts_7d),
							failed7d: Number(m.failed_7d),
							found7d: Number(m.found_7d),
							notFound7d: Number(m.not_found_7d),
							lastVisitAt: m.last_visit_at,
						}
					: { ...EMPTY_COUNTERS }

				siteVisits7d += c.visits7d
				totals.visits7d += c.visits7d
				totals.visits30d += c.visits30d
				totals.attempts7d += c.attempts7d
				totals.failed7d += c.failed7d
				totals.found7d += c.found7d
				totals.notFound7d += c.notFound7d

				const pos = t.positionHistory[0]
				const { status, statusReason } = this.computeKeywordStatus(c, t.isActive, t.keywordStatus)
				return {
					id: t.id,
					keyword: t.keyword,
					geo: t.geo,
					isActive: t.isActive,
					keywordStatus: t.keywordStatus,
					useYandex: t.useYandex,
					useGoogle: t.useGoogle,
					maxYandexVisits: t.maxYandexVisits,
					maxGoogleVisits: t.maxGoogleVisits,
					yandexPosition: pos?.yandexPosition ?? null,
					googlePosition: pos?.googlePosition ?? null,
					positionDate: pos?.date ?? null,
					visits7d: c.visits7d,
					attempts7d: c.attempts7d,
					notFound7d: c.notFound7d,
					lastVisitAt: c.lastVisitAt,
					status,
					statusReason,
				}
			})

			return {
				id: w.id,
				name: w.name,
				url: w.url,
				isActive: w.isActive,
				isApproved: w.isApproved,
				isRestricted: w.isRestricted,
				dailyVisitsTarget: w.dailyVisitsTarget,
				autoMaxVisits: w.autoMaxVisits,
				createdAt: w.createdAt,
				visits7d: siteVisits7d,
				keywords,
			}
		})

		const failures7d = failureGroups
			.map(f => ({
				reason: f.failureReason as string,
				label: FAILURE_LABELS[f.failureReason as string] ?? (f.failureReason as string),
				count: f._count._all,
			}))
			.sort((a, b) => b.count - a.count)

		const allKeywords = sitesOut.flatMap(s => s.keywords)
		const activeKeywords = allKeywords.filter(
			k => k.isActive && k.keywordStatus === 'ACTIVE',
		).length
		const hasApprovedSite = user.websites.some(w => w.isApproved)
		const { health, healthReason } = this.computeHealth(totals, activeKeywords, hasApprovedSite)

		const issues: string[] = []
		for (const k of allKeywords) {
			if (k.status === 'bad' || k.status === 'warn') {
				issues.push(`«${k.keyword ?? '—'}» — ${k.statusReason.toLowerCase()}`)
			}
		}
		if (totals.failed7d > 0 && failures7d.length > 0) {
			const top = failures7d[0]
			issues.push(
				`${totals.failed7d} из ${totals.attempts7d} ${plural(totals.attempts7d, 'попытки', 'попыток', 'попыток')} упали: ${top.label.toLowerCase()}`,
			)
		}

		return {
			client,
			summary: {
				health,
				text: this.buildSummaryText(health, healthReason, totals, allKeywords, failures7d[0]),
				issues,
			},
			totals: {
				visits7d: totals.visits7d,
				visits30d: totals.visits30d,
				attempts7d: totals.attempts7d,
				failed7d: totals.failed7d,
				successRate7d: this.successRate(totals.visits7d, totals.attempts7d),
				found7d: totals.found7d,
				notFound7d: totals.notFound7d,
			},
			chart: this.buildChart(chartRows),
			failures7d,
			sites: sitesOut,
		}
	}

	// Ровно 30 точек по возрастанию, дни без данных — нулями, последняя точка = сегодня (МСК).
	private buildChart(rows: Array<{ d: string; visits: bigint; attempts: bigint; failed: bigint }>) {
		const byDay = new Map(rows.map(r => [r.d, r]))
		const today = Date.now()
		const out: Array<{ date: string; visits: number; attempts: number; failed: number }> = []
		for (let i = 29; i >= 0; i--) {
			const date = mskDayKey(new Date(today - i * DAY))
			const r = byDay.get(date)
			out.push({
				date,
				visits: r ? Number(r.visits) : 0,
				attempts: r ? Number(r.attempts) : 0,
				failed: r ? Number(r.failed) : 0,
			})
		}
		return out
	}

	// Человеческий вывод на 1-3 предложения: работает клиент или нет и почему.
	private buildSummaryText(
		health: Health,
		healthReason: string,
		totals: Counters,
		keywords: Array<{ status: Health }>,
		topFailure?: { label: string },
	): string {
		if (health === 'idle') {
			return `Клиент пока не работает: ${healthReason.toLowerCase()}.`
		}

		const working = keywords.filter(k => k.status === 'ok' || k.status === 'warn').length
		const counted = keywords.filter(k => k.status !== 'idle').length

		if (totals.visits7d === 0) {
			const parts = ['Визитов за неделю нет.']
			// Советовать смену запросов можно только если падения — это реально NOT_IN_SERP.
			const notFoundDominates = totals.failed7d > 0 && totals.notFound7d / totals.failed7d > 0.5
			if (counted > 0 && working === 0 && notFoundDominates) {
				parts.push(
					`По ${counted === 1 ? 'единственному запросу' : `всем ${counted} запросам`} сайт не находится в топ-50 — раскручивать нечего, нужно менять запросы.`,
				)
			} else if (topFailure) {
				parts.push(`Попытки падают: ${topFailure.label.toLowerCase()}.`)
			}
			return parts.join(' ')
		}

		const visitsPhrase = `${totals.visits7d} ${plural(totals.visits7d, 'визит', 'визита', 'визитов')}`
		const parts = [
			counted > 0
				? `За неделю ${visitsPhrase}, сайт находится по ${working} из ${counted} ${plural(counted, 'запроса', 'запросов', 'запросов')}.`
				: `За неделю ${visitsPhrase}.`,
		]
		if (health === 'ok') {
			parts.push('Всё работает.')
		} else if (totals.failed7d > 0 && topFailure) {
			parts.push(
				`Но ${totals.failed7d} из ${totals.attempts7d} ${plural(totals.attempts7d, 'попытки', 'попыток', 'попыток')} упали: ${topFailure.label.toLowerCase()}.`,
			)
		} else {
			parts.push(`${healthReason}.`)
		}
		return parts.join(' ')
	}

	// ——— Динамика позиций по ключевикам клиента ———

	async getClientTrend(userId: string) {
		const websites = await this.prisma.website.findMany({
			where: { userId },
			select: { id: true, url: true },
		})
		// Та же проверка «клиент = пользователь с сайтами», что и в getClient.
		if (websites.length === 0) throw new NotFoundException('Клиент не найден')

		const siteIds = websites.map(w => w.id)
		const sites = Prisma.join(siteIds)
		const now = Date.now()
		const from = new Date(now - 90 * DAY)
		// Граница окна visits30d — начало дня 30 точек назад по МСК.
		const from30 = mskDayKey(new Date(now - 29 * DAY))

		const [tasks, positionRows, visitRows] = await Promise.all([
			this.prisma.task.findMany({
				where: { websiteId: { in: siteIds } },
				orderBy: { createdAt: 'asc' },
				select: { id: true, keyword: true, websiteId: true },
			}),
			// 101 и null = «не найден», в график не идут. День режем по МСК тем же
			// сдвигом, что и визиты ниже, иначе точки двух рядов разъедутся на сутки.
			this.prisma.$queryRaw<Array<{
				task_id: string
				d: string
				yandex_pos: number | null
				google_pos: number | null
			}>>`
				SELECT
					ph."taskId" AS task_id,
					to_char(ph."createdAt" + interval '3 hours', 'YYYY-MM-DD') AS d,
					MIN(CASE WHEN ph."yandexPosition" < 101 THEN ph."yandexPosition" END) AS yandex_pos,
					MIN(CASE WHEN ph."googlePosition" < 101 THEN ph."googlePosition" END) AS google_pos
				FROM position_history ph
				JOIN tasks t ON t.id = ph."taskId"
				WHERE t."websiteId" IN (${sites})
					AND ph."createdAt" >= ${from}
				GROUP BY 1, 2
			`,
			this.prisma.$queryRaw<Array<{ task_id: string; d: string; visits: bigint }>>`
				SELECT
					e."taskId" AS task_id,
					to_char(e."createdAt" + interval '3 hours', 'YYYY-MM-DD') AS d,
					COUNT(*) AS visits
				FROM executions e
				JOIN tasks t ON t.id = e."taskId"
				WHERE t."websiteId" IN (${sites})
					AND e.status = 'COMPLETED'
					AND e."targetVisited" = true
					AND e."createdAt" >= ${from}
				GROUP BY 1, 2
			`,
		])

		const urlBySite = new Map(websites.map(w => [w.id, w.url]))
		// Позиции и визиты живут в разных таблицах — набор дней у них разный.
		// Сливаем по ключу дня: день в графике есть, если есть хоть позиция, хоть визит.
		const byTask = new Map<string, Map<string, { date: string; yandex: number | null; google: number | null; visits: number }>>()
		const dayOf = (taskId: string, d: string) => {
			let days = byTask.get(taskId)
			if (!days) {
				days = new Map()
				byTask.set(taskId, days)
			}
			let day = days.get(d)
			if (!day) {
				day = { date: d, yandex: null, google: null, visits: 0 }
				days.set(d, day)
			}
			return day
		}
		for (const r of positionRows) {
			const day = dayOf(r.task_id, r.d)
			day.yandex = r.yandex_pos != null ? Number(r.yandex_pos) : null
			day.google = r.google_pos != null ? Number(r.google_pos) : null
		}
		for (const r of visitRows) {
			dayOf(r.task_id, r.d).visits = Number(r.visits)
		}

		const keywords = tasks.map(t => {
			const history = Array.from(byTask.get(t.id)?.values() ?? []).sort((a, b) =>
				a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
			)
			const firstY = history.find(h => h.yandex != null)?.yandex ?? null
			const lastY = [...history].reverse().find(h => h.yandex != null)?.yandex ?? null
			const firstG = history.find(h => h.google != null)?.google ?? null
			const lastG = [...history].reverse().find(h => h.google != null)?.google ?? null
			return {
				taskId: t.id,
				keyword: t.keyword,
				siteUrl: urlBySite.get(t.websiteId) ?? '',
				history,
				firstYandex: firstY,
				lastYandex: lastY,
				yandexDelta: firstY != null && lastY != null ? firstY - lastY : null,
				firstGoogle: firstG,
				lastGoogle: lastG,
				googleDelta: firstG != null && lastG != null ? firstG - lastG : null,
				visits30d: history.reduce((s, h) => (h.date >= from30 ? s + h.visits : s), 0),
			}
		})

		// Кто просел — первым; у кого дельты нет, тот в конец.
		keywords.sort((a, b) => {
			if (a.yandexDelta == null) return b.yandexDelta == null ? 0 : 1
			if (b.yandexDelta == null) return -1
			return a.yandexDelta - b.yandexDelta
		})
		return { keywords }
	}

	// ——— Кого дожимать ———

	async getOutreach() {
		const now = Date.now()
		const d7 = new Date(now - 7 * DAY)

		const [paid, lowBalanceCandidates] = await Promise.all([
			this.prisma.payment.groupBy({
				by: ['userId'],
				where: { status: 'SUCCEEDED' },
				_count: { _all: true },
				_sum: { amount: true },
				_max: { createdAt: true },
			}),
			this.prisma.user.findMany({
				where: { websites: { some: {} }, balance: { lt: 200 } },
				select: { id: true },
			}),
		])

		const paidByUser = new Map(paid.map(p => [p.userId, p]))
		const daysSince = (at: Date) => Math.floor((now - at.getTime()) / DAY)

		// Отвалившиеся: платил, последний успешный платёж 30..120 дней назад.
		// _max.createdAt по SUCCEEDED — он же «последний», поэтому платежей после него нет по построению.
		const churnedIds = paid
			.filter(p => {
				const last = p._max.createdAt
				if (!last) return false
				const n = daysSince(last)
				return n >= 30 && n <= 120
			})
			.map(p => p.userId)
		// Без оплат вовсе: сайт есть, баланс мал, ни одного SUCCEEDED.
		const lowIds = lowBalanceCandidates.map(u => u.id).filter(id => !paidByUser.has(id))

		const ids = [...new Set([...churnedIds, ...lowIds])]
		if (ids.length === 0) return { churned: [], lowBalance: [] }

		const [users, activeTasks, visitRows] = await Promise.all([
			this.prisma.user.findMany({
				where: { id: { in: ids } },
				select: {
					id: true, email: true, telegramContact: true, createdAt: true, balance: true,
					websites: { select: { id: true } },
				},
			}),
			this.prisma.task.groupBy({
				by: ['websiteId'],
				where: { isActive: true, keywordStatus: 'ACTIVE', website: { userId: { in: ids } } },
				_count: { _all: true },
			}),
			this.prisma.$queryRaw<Array<{ user_id: string; visits: bigint }>>`
				SELECT w."userId" AS user_id, COUNT(*) AS visits
				FROM executions e
				JOIN tasks t ON t.id = e."taskId"
				JOIN websites w ON w.id = t."websiteId"
				WHERE w."userId" IN (${Prisma.join(ids)})
					AND e.status = 'COMPLETED'
					AND e."targetVisited" = true
					AND e."createdAt" >= ${d7}
				GROUP BY 1
			`,
		])

		const activeByWebsite = new Map(activeTasks.map(t => [t.websiteId, t._count._all]))
		const visitsByUser = new Map(visitRows.map(r => [r.user_id, Number(r.visits)]))

		const base = new Map(users.map(u => {
			const p = paidByUser.get(u.id)
			const lastPaymentAt = p?._max.createdAt ?? null
			return [u.id, {
				id: u.id,
				email: u.email,
				telegramContact: u.telegramContact,
				createdAt: u.createdAt,
				sitesCount: u.websites.length,
				activeKeywords: u.websites.reduce((s, w) => s + (activeByWebsite.get(w.id) ?? 0), 0),
				balance: u.balance,
				paymentsCount: p?._count._all ?? 0,
				paidTotal: Number(p?._sum.amount ?? 0),
				lastPaymentAt,
				daysSincePayment: lastPaymentAt ? daysSince(lastPaymentAt) : null,
				visits7d: visitsByUser.get(u.id) ?? 0,
			}]
		}))

		const churned = churnedIds
			.map(id => base.get(id))
			.filter((r): r is NonNullable<typeof r> => !!r)
			.map(r => ({
				...r,
				reason: `Оплатил ${r.paymentsCount} раз, последний ${r.daysSincePayment} дней назад — второй месяц не продлил`,
				suggestion: 'Спросить, что не так: не увидел результат, дорого или что-то другое',
			}))
			// Кто отвалился недавно — тёплый, ему первым.
			.sort((a, b) => (a.daysSincePayment ?? 0) - (b.daysSincePayment ?? 0))

		const lowBalance = lowIds
			.map(id => base.get(id))
			.filter((r): r is NonNullable<typeof r> => !!r)
			.map(r => ({
				...r,
				reason: `Сайт добавлен, но не оплачивал. Баланс ${r.balance} — на визиты не хватит`,
				suggestion: r.telegramContact
					? `Написать в Telegram: ${r.telegramContact}`
					: 'Написать на почту — Telegram не указан',
			}))
			// Сначала с телеграмом, внутри — кто больше вложился в настройку.
			.sort((a, b) =>
				Number(!!b.telegramContact) - Number(!!a.telegramContact) || b.activeKeywords - a.activeKeywords,
			)

		return { churned, lowBalance }
	}

	// ——— Журнал выполнений ———
	// Этот же метод переиспользует админка (GET /admin/users/:id/logs).
	async getClientLogs(userId: string, limit = 100) {
		const parsed = Number(limit)
		const take = Math.min(Math.max(Number.isFinite(parsed) ? Math.trunc(parsed) : 100, 1), 500)

		const websites = await this.prisma.website.findMany({
			where: { userId },
			select: { id: true },
		})
		if (websites.length === 0) return []

		const rows = await this.prisma.execution.findMany({
			// Незавершённые выполнения в журнал не берём — фронт красит любой не-COMPLETED в «ошибку».
			where: {
				task: { websiteId: { in: websites.map(w => w.id) } },
				status: { in: ['COMPLETED', 'FAILED'] },
			},
			orderBy: { createdAt: 'desc' },
			take,
			select: {
				id: true, status: true, completionKind: true, failureReason: true,
				foundInTop: true, position: true,
				yandexFoundInTop: true, googleFoundInTop: true,
				targetVisited: true, directNavigationUsed: true,
				createdAt: true, completedAt: true, duration: true,
				task: { select: { keyword: true, website: { select: { url: true } } } },
				executor: { select: { email: true, appVersion: true } },
			},
		})

		// Последний failure-шаг по всем выполнениям сразу — без N+1.
		const events = await this.prisma.executionEvent.findMany({
			where: { executionId: { in: rows.map(r => r.id) }, type: 'failure' },
			orderBy: { createdAt: 'asc' },
			select: { executionId: true, stage: true },
		})
		const stageByExecution = new Map<string, string>()
		for (const e of events) stageByExecution.set(e.executionId, e.stage)

		return rows.map(r => ({
			id: r.id,
			status: r.status,
			completionKind: r.completionKind,
			failureReason: r.failureReason,
			foundInTop: r.foundInTop,
			position: r.position,
			yandexFoundInTop: r.yandexFoundInTop,
			googleFoundInTop: r.googleFoundInTop,
			targetVisited: r.targetVisited,
			directNavigationUsed: r.directNavigationUsed,
			createdAt: r.createdAt,
			completedAt: r.completedAt,
			duration: r.duration,
			keyword: r.task?.keyword ?? null,
			siteUrl: r.task?.website?.url ?? null,
			executorEmail: r.executor?.email ?? null,
			executorAppVersion: r.executor?.appVersion ?? null,
			lastFailureStage: stageByExecution.get(r.id) ?? null,
		}))
	}

	// ——— Трейс ———

	async getTrace(executionId: string, user: { role?: string }) {
		// Менеджеру доступны трейсы только по выполнениям, привязанным к сайту клиента; админу — любые.
		if (user?.role !== 'ADMIN') {
			const ex = await this.prisma.execution.findUnique({
				where: { id: executionId },
				select: { task: { select: { website: { select: { id: true } } } } },
			})
			if (!ex) return { text: 'Выполнение не найдено', execution: null }
			if (!ex.task?.website) throw new NotFoundException('Выполнение не найдено')
		}
		return loadExecutionTrace(this.prisma, executionId)
	}
}
