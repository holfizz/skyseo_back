/**
 * ⚠️  ПЕРЕД ИЗМЕНЕНИЕМ ЭТОГО ФАЙЛА — ПРОЧИТАЙ ДОКУМЕНТАЦИЮ ДВИЖКА: skyseo_app/ENGINE.md
 *     (документация лежит в репозитории Electron-приложения и описывает движок целиком: бэк + клиент)
 *
 *     Профильный раздел: §5 «Формулы и константы» → ёмкость сети и баллы
 *
 *     Файл — часть движка выдачи задач и работы с поисковой выдачей. В движке много
 *     неочевидных связей: лимиты, кулдауны, антифрод-логика, договорённости между
 *     бэкендом и Electron-приложением. Правка «по месту» почти всегда ломает что-то
 *     на другом конце цепочки. Сначала прочитай контекст — потом меняй код.
 *
 *     Отдельно: §13.0 документации перечисляет поведение, которое ВЫГЛЯДИТ багом,
 *     но является осознанным решением. Не «чини» его без обсуждения.
 */

import { BadRequestException, Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

export const KEY_GOOGLE_SOCS = 'google_socs'
export const KEY_GOOGLE_CONSENT = 'google_consent'

// Best-effort дефолты «accept all». Если в БД ничего нет — отдаём их.
// SOCS со временем устаревает — обновляется в админке (/holfizz/settings) без пересборки app.
export const DEFAULT_GOOGLE_SOCS = 'CAISHAgCEhJnd3NfMjAyNjA2MDQtMF9SQzEaAnJ1IAEaBgiAxo3RBg'
export const DEFAULT_GOOGLE_CONSENT = 'YES+'

// Баллы за выполнение задач — настраиваются в /holfizz/settings
export const KEY_POINTS_FOUND_EARNED = 'points_found_earned'     // исполнитель получает, когда нашёл
export const KEY_POINTS_FOUND_SPENT = 'points_found_spent'       // владелец тратит, когда нашли
export const KEY_POINTS_NOT_FOUND_EARNED = 'points_not_found_earned' // исполнитель получает, когда не нашёл
export const KEY_POINTS_NOT_FOUND_SPENT = 'points_not_found_spent'   // владелец тратит, когда не нашли
export const DEFAULT_POINTS_FOUND_EARNED = '15'
export const DEFAULT_POINTS_FOUND_SPENT = '30'
export const DEFAULT_POINTS_NOT_FOUND_EARNED = '5'
export const DEFAULT_POINTS_NOT_FOUND_SPENT = '0'

// Админ-override числа активных ПК в сети (для расчёта потолка). Пусто = авто.
export const KEY_NETWORK_ACTIVE_PCS = 'network_active_pcs'

/**
 * Глубина перелистывания выдачи по возрасту профиля ПК.
 * Формат — человекочитаемые диапазоны: «1-6:3, 7-13:4, 14+:5» читается как
 * «дни 1–6 листаем 3 страницы, 7–13 — четыре, с 14-го и дальше — пять».
 * Раньше это было зашито в код приложения (config.ts), то есть менялось только
 * выкатом новой версии. Теперь приложение тянет значение с сервера.
 */
export const KEY_SERP_PAGE_RAMP = 'serp_page_ramp'
export const DEFAULT_SERP_PAGE_RAMP = '1-6:3, 7-13:4, 14+:5'

// Цена продвижения, которая печатается в PDF-отчёте холодному лиду.
// Фиксированных тарифов нет: в отчёте стоит «от N ₽ в месяц», а точную сумму
// называет менеджер. Значение правится в админке, чтобы поднять ценник
// не пересобирая бэкенд.
const KEY_REPORT_PRICE = 'report_price_from'
export const DEFAULT_REPORT_PRICE = '9000'

/**
 * Как приложение находит кнопку «Дальше» в выдаче. Держим в БД, потому что
 * поисковики меняют вёрстку, а выкат новой версии приложения — долгая история.
 *
 * css — CSS-селектор (можно несколько через запятую). Пробуется первым: клик по
 *       найденному элементу выглядит естественнее всего.
 * text — слова, с которых начинается подпись кнопки (regexp-альтернативы через |).
 *        Запасной путь: классы меняются каждой сборкой, а слово «дальше» — нет.
 */
export const KEY_SERP_NEXT_CSS_YANDEX = 'serp_next_css_yandex'
export const KEY_SERP_NEXT_CSS_GOOGLE = 'serp_next_css_google'
export const KEY_SERP_NEXT_TEXT_YANDEX = 'serp_next_text_yandex'
export const KEY_SERP_NEXT_TEXT_GOOGLE = 'serp_next_text_google'
export const DEFAULT_SERP_NEXT_CSS_YANDEX =
	'.Pager-Item_type_next a, a.Pager-Item_type_next, [aria-label="Следующая страница"]'
export const DEFAULT_SERP_NEXT_CSS_GOOGLE =
	'#pnnext, a#pnnext, a[aria-label="Next page"], a[aria-label="Следующая"]'
export const DEFAULT_SERP_NEXT_TEXT_YANDEX = 'дальше|следующая'
export const DEFAULT_SERP_NEXT_TEXT_GOOGLE = 'next|дальше|следующая'

/**
 * Селекторы разбора выдачи. Ломаются реже пагинации, но дороже: если приложение
 * не распознало результаты, выполнение бесполезно целиком — не видно ни сайта,
 * ни конкурентов. На проде такое уже случается (события serp_zero_dom).
 *
 * Приложение пробует значение отсюда, и ТОЛЬКО если оно не нашло на странице
 * ни одного элемента — откатывается на зашитый селектор. Кривая настройка
 * поэтому не может остановить сеть.
 */
/**
 * Режим нагрузки на один ПК. Раньше жил только в config.ts приложения, то есть
 * подбирался выкатом сборки. Хранится одним JSON, потому что параметры правятся
 * пачкой и по отдельности смысла не имеют.
 *
 * Осторожно: это ручки антидетекта. Слишком частые задачи и короткие паузы —
 * прямой путь к капче и потере трастового скора у всей сети.
 */
export const KEY_APP_LOAD_CONFIG = 'app_load_config'
export const DEFAULT_APP_LOAD = {
	dailyVisitLimit: 20,
	dailyRampUp: '1:6, 2:12, 3:20',
	taskGapSec: { min: 480, max: 1320 },
	captchaCooldownMin: { min: 90, max: 240 },
	phaseGapMs: { min: 4000, max: 9000 },
	paginationGapMs: { min: 4500, max: 9000 },
}
export type AppLoadConfig = typeof DEFAULT_APP_LOAD

export const KEY_SERP_PARSE_YANDEX_ITEM = 'serp_parse_yandex_item'
export const KEY_SERP_PARSE_YANDEX_TITLE = 'serp_parse_yandex_title'
export const KEY_SERP_PARSE_GOOGLE_ROOT = 'serp_parse_google_root'
export const KEY_SERP_PARSE_GOOGLE_LINKS = 'serp_parse_google_links'
export const DEFAULT_SERP_PARSE_YANDEX_ITEM = 'li[data-cid]'
export const DEFAULT_SERP_PARSE_YANDEX_TITLE = 'a.OrganicTitle-Link'
export const DEFAULT_SERP_PARSE_GOOGLE_ROOT = '#rso'
// 14.08.2026 Google ослепил разбор на 86% ПК: между .yuRUbf и ссылкой появились
// две новые обёртки, и прежний '.yuRUbf > a' (ПРЯМОЙ ребёнок) перестал совпадать.
// Проверено на живой выдаче:
//   h3.LC20lb → a.zReHs[href] → span.V9tjod → div.b8lM7 → div.yuRUbf
// Берём потомка на любой глубине — вложенность больше не важна. Вторая ветка
// 'a:has(h3)' независима от классов вообще: у органики заголовок всегда в h3
// внутри ссылки. Обе дают ровно по 10 результатов и один и тот же набор.
//
// '.tF2Cxc a[href]' НЕ возвращать: на живой странице он даёт 19 ссылок вместо 10
// и сдвигает позиции. Широкие ветки ('.g a[jsname]', 'div[data-hveid] a[href*=…]')
// убраны по той же причине.
export const DEFAULT_SERP_PARSE_GOOGLE_LINKS = '.yuRUbf a[href], a:has(h3)'

@Injectable()
export class AppConfigService {
	constructor(private prisma: PrismaService) {}

	async get(key: string, fallback: string): Promise<string> {
		const row = await this.prisma.appConfig.findUnique({ where: { key } })
		return row?.value ?? fallback
	}

	async getWithMeta(key: string, fallback: string) {
		const row = await this.prisma.appConfig.findUnique({ where: { key } })
		return { value: row?.value ?? fallback, updatedAt: row?.updatedAt ?? null, isDefault: !row }
	}

	async set(key: string, value: string) {
		return this.prisma.appConfig.upsert({
			where: { key },
			create: { key, value },
			update: { value },
		})
	}

	async getPointsConfig() {
		const [foundEarned, foundSpent, notFoundEarned, notFoundSpent] = await Promise.all([
			this.get(KEY_POINTS_FOUND_EARNED, DEFAULT_POINTS_FOUND_EARNED),
			this.get(KEY_POINTS_FOUND_SPENT, DEFAULT_POINTS_FOUND_SPENT),
			this.get(KEY_POINTS_NOT_FOUND_EARNED, DEFAULT_POINTS_NOT_FOUND_EARNED),
			this.get(KEY_POINTS_NOT_FOUND_SPENT, DEFAULT_POINTS_NOT_FOUND_SPENT),
		])
		return {
			foundEarned: parseInt(foundEarned, 10),
			foundSpent: parseInt(foundSpent, 10),
			notFoundEarned: parseInt(notFoundEarned, 10),
			notFoundSpent: parseInt(notFoundSpent, 10),
		}
	}

	async getPointsConfigWithMeta() {
		const [foundEarned, foundSpent, notFoundEarned, notFoundSpent] = await Promise.all([
			this.getWithMeta(KEY_POINTS_FOUND_EARNED, DEFAULT_POINTS_FOUND_EARNED),
			this.getWithMeta(KEY_POINTS_FOUND_SPENT, DEFAULT_POINTS_FOUND_SPENT),
			this.getWithMeta(KEY_POINTS_NOT_FOUND_EARNED, DEFAULT_POINTS_NOT_FOUND_EARNED),
			this.getWithMeta(KEY_POINTS_NOT_FOUND_SPENT, DEFAULT_POINTS_NOT_FOUND_SPENT),
		])
		return { foundEarned, foundSpent, notFoundEarned, notFoundSpent }
	}

	// Что читает desktop-app перед заходом в Google
	async getGoogleConfig() {
		const [socs, consent] = await Promise.all([
			this.get(KEY_GOOGLE_SOCS, DEFAULT_GOOGLE_SOCS),
			this.get(KEY_GOOGLE_CONSENT, DEFAULT_GOOGLE_CONSENT),
		])
		return { socs, consent }
	}

	// Ёмкость сети: один ПК посещает один сайт не чаще раза в 2 недели (потом
	// повтор), поэтому в любой день «свежи» только 1/14 активного парка → потолок
	// просмотров в день на сайт = ceil(среднее активных ПК в день / 14).
	// Это единый источник правды: и валидация ввода юзера, и реальный cap выдачи
	// (см. TasksService.getNetworkPerSiteCapacity).
	static readonly CAPACITY_SPREAD_DAYS = 14
	// В деве в сети реально 1 ПК — подставляем фикс, чтобы видеть математику потолка.
	// Меняй число, чтобы посмотреть разные потолки (напр. 140 → ceil(140/14)=10/день).
	static readonly DEV_FAKE_ACTIVE_PCS = 10
	private capacityCache: {
		value: { activePcsWeek: number; avgPerDay: number; maxPerDay: number }
		expiresAt: number
	} | null = null

	/**
	 * Разбор строки диапазонов в карту «день → страниц» + значение после последнего дня.
	 * Любая нераспознанная часть игнорируется; если не разобралось вообще ничего —
	 * откатываемся на дефолт, чтобы кривая строка в настройках не остановила сеть.
	 */
	private parseSerpRamp(raw: string, maxValue = 10): { ramp: Record<number, number>; final: number } {
		const ramp: Record<number, number> = {}
		let final = 0
		for (const part of String(raw || '').split(',')) {
			const m = part.trim().match(/^(\d+)\s*(?:-\s*(\d+)|(\+))?\s*:\s*(\d+)$/)
			if (!m) continue
			const from = parseInt(m[1], 10)
			const pages = Math.max(1, Math.min(maxValue, parseInt(m[4], 10)))
			if (m[3] === '+') {
				final = pages
				continue
			}
			const to = m[2] ? parseInt(m[2], 10) : from
			if (to < from || to - from > 400) continue
			for (let d = from; d <= to; d++) ramp[d] = pages
		}
		if (!final && Object.keys(ramp).length === 0) return this.parseSerpRamp(DEFAULT_SERP_PAGE_RAMP, maxValue)
		return { ramp, final: final || 5 }
	}

	/** Цена «от», которую видит лид в отчёте. Число в рублях. */
	async getReportPrice() {
		const { value, updatedAt, isDefault } = await this.getWithMeta(KEY_REPORT_PRICE, DEFAULT_REPORT_PRICE)
		const price = Number(value)
		return {
			price: Number.isFinite(price) && price > 0 ? Math.round(price) : Number(DEFAULT_REPORT_PRICE),
			updatedAt,
			isDefault,
			default: Number(DEFAULT_REPORT_PRICE),
		}
	}

	async setReportPrice(raw: number | string) {
		const price = Math.round(Number(raw))
		// Верхнюю границу не ставим, а нижнюю ставим: ноль или минус в отчёте
		// клиенту выглядел бы как «бесплатно», и это уже обещание.
		if (!Number.isFinite(price) || price <= 0) {
			throw new BadRequestException('Цена должна быть положительным числом рублей')
		}
		await this.set(KEY_REPORT_PRICE, String(price))
		return this.getReportPrice()
	}

	async getSerpPageRamp() {
		const { value, updatedAt, isDefault } = await this.getWithMeta(KEY_SERP_PAGE_RAMP, DEFAULT_SERP_PAGE_RAMP)
		const parsed = this.parseSerpRamp(value)
		return { raw: value, ...parsed, updatedAt, isDefault, default: DEFAULT_SERP_PAGE_RAMP }
	}

	async setSerpPageRamp(raw: string) {
		const value = String(raw || '').trim() || DEFAULT_SERP_PAGE_RAMP
		// Проверяем ИСХОДНУЮ строку, а не результат разбора: parseSerpRamp на мусоре
		// молча откатывается к дефолту, и без этой проверки мусор бы сохранился.
		const hasValidPart = value
			.split(',')
			.some(part => /^\d+\s*(?:-\s*\d+|\+)?\s*:\s*\d+$/.test(part.trim()))
		if (!hasValidPart) {
			throw new BadRequestException('Не разобрать строку. Пример: 1-6:3, 7-13:4, 14+:5')
		}
		await this.set(KEY_SERP_PAGE_RAMP, value)
		return this.getSerpPageRamp()
	}

	/** Селекторы кнопки «Дальше» для обоих поисковиков. */
	async getSerpNavConfig() {
		const [cssY, cssG, textY, textG] = await Promise.all([
			this.getWithMeta(KEY_SERP_NEXT_CSS_YANDEX, DEFAULT_SERP_NEXT_CSS_YANDEX),
			this.getWithMeta(KEY_SERP_NEXT_CSS_GOOGLE, DEFAULT_SERP_NEXT_CSS_GOOGLE),
			this.getWithMeta(KEY_SERP_NEXT_TEXT_YANDEX, DEFAULT_SERP_NEXT_TEXT_YANDEX),
			this.getWithMeta(KEY_SERP_NEXT_TEXT_GOOGLE, DEFAULT_SERP_NEXT_TEXT_GOOGLE),
		])
		const [pyItem, pyTitle, pgRoot, pgLinks] = await Promise.all([
			this.getWithMeta(KEY_SERP_PARSE_YANDEX_ITEM, DEFAULT_SERP_PARSE_YANDEX_ITEM),
			this.getWithMeta(KEY_SERP_PARSE_YANDEX_TITLE, DEFAULT_SERP_PARSE_YANDEX_TITLE),
			this.getWithMeta(KEY_SERP_PARSE_GOOGLE_ROOT, DEFAULT_SERP_PARSE_GOOGLE_ROOT),
			this.getWithMeta(KEY_SERP_PARSE_GOOGLE_LINKS, DEFAULT_SERP_PARSE_GOOGLE_LINKS),
		])
		return {
			yandex: { css: cssY, text: textY },
			google: { css: cssG, text: textG },
			parse: {
				yandexItem: pyItem,
				yandexTitle: pyTitle,
				googleRoot: pgRoot,
				googleLinks: pgLinks,
			},
			defaults: {
				yandex: { css: DEFAULT_SERP_NEXT_CSS_YANDEX, text: DEFAULT_SERP_NEXT_TEXT_YANDEX },
				google: { css: DEFAULT_SERP_NEXT_CSS_GOOGLE, text: DEFAULT_SERP_NEXT_TEXT_GOOGLE },
				parse: {
					yandexItem: DEFAULT_SERP_PARSE_YANDEX_ITEM,
					yandexTitle: DEFAULT_SERP_PARSE_YANDEX_TITLE,
					googleRoot: DEFAULT_SERP_PARSE_GOOGLE_ROOT,
					googleLinks: DEFAULT_SERP_PARSE_GOOGLE_LINKS,
				},
			},
		}
	}

	async setSerpNavConfig(body: {
		yandexCss?: string
		googleCss?: string
		yandexText?: string
		googleText?: string
		parseYandexItem?: string
		parseYandexTitle?: string
		parseGoogleRoot?: string
		parseGoogleLinks?: string
	}) {
		// Селектор уедет в document.querySelector внутри приложения. Кавычки в нём
		// законны ([aria-label="..."]), а вот перенос строки и угловые скобки — признак
		// того, что вставили не то; и пустая строка убила бы первый уровень поиска.
		const clean = (v: string | undefined, field: string): string | null => {
			if (v == null) return null
			const t = String(v).trim()
			if (!t) throw new BadRequestException(`${field}: пустое значение`)
			if (t.length > 500) throw new BadRequestException(`${field}: слишком длинно`)
			// '>' НЕ запрещаем: это дочерний комбинатор CSS, он есть в самом дефолте
			// ('.yuRUbf > a'), и запрет делал дефолт невводимым через админку — в инцидент
			// с Google это мешало откатить селектор обратно.
			if (/[<\n\r]/.test(t)) throw new BadRequestException(`${field}: недопустимые символы`)
			return t
		}
		const textOk = (v: string | null, field: string) => {
			if (v == null) return null
			try {
				new RegExp(v)
			} catch {
				throw new BadRequestException(`${field}: не читается как шаблон. Пример: дальше|следующая`)
			}
			return v
		}
		const pairs: [string, string | null][] = [
			[KEY_SERP_NEXT_CSS_YANDEX, clean(body.yandexCss, 'Яндекс, селектор')],
			[KEY_SERP_NEXT_CSS_GOOGLE, clean(body.googleCss, 'Google, селектор')],
			[KEY_SERP_NEXT_TEXT_YANDEX, textOk(clean(body.yandexText, 'Яндекс, текст'), 'Яндекс, текст')],
			[KEY_SERP_NEXT_TEXT_GOOGLE, textOk(clean(body.googleText, 'Google, текст'), 'Google, текст')],
			[KEY_SERP_PARSE_YANDEX_ITEM, clean(body.parseYandexItem, 'Яндекс, блок результата')],
			[KEY_SERP_PARSE_YANDEX_TITLE, clean(body.parseYandexTitle, 'Яндекс, ссылка-заголовок')],
			[KEY_SERP_PARSE_GOOGLE_ROOT, clean(body.parseGoogleRoot, 'Google, контейнер выдачи')],
			[KEY_SERP_PARSE_GOOGLE_LINKS, clean(body.parseGoogleLinks, 'Google, ссылки результатов')],
		]
		for (const [key, value] of pairs) if (value != null) await this.set(key, value)
		return this.getSerpNavConfig()
	}

	/** Настройки нагрузки: сохранённые поверх дефолтов + сами дефолты для UI. */
	async getLoadConfig() {
		const { value, updatedAt, isDefault } = await this.getWithMeta(KEY_APP_LOAD_CONFIG, '')
		let stored: Partial<AppLoadConfig> = {}
		if (value) {
			try {
				stored = JSON.parse(value)
			} catch {
				stored = {} // мусор в БД не должен ронять выдачу конфига
			}
		}
		const current: AppLoadConfig = { ...DEFAULT_APP_LOAD, ...stored }
		return {
			current,
			dailyRamp: this.parseSerpRamp(current.dailyRampUp, 500).ramp,
			defaults: DEFAULT_APP_LOAD,
			updatedAt,
			isDefault,
		}
	}

	async setLoadConfig(body: Partial<AppLoadConfig>) {
		const num = (v: unknown, field: string, lo: number, hi: number): number => {
			const n = Number(v)
			if (!Number.isFinite(n) || n < lo || n > hi) {
				throw new BadRequestException(`${field}: допустимо ${lo}–${hi}`)
			}
			return Math.round(n)
		}
		const range = (v: any, field: string, lo: number, hi: number) => {
			const min = num(v?.min, `${field}, мин`, lo, hi)
			const max = num(v?.max, `${field}, макс`, lo, hi)
			if (max < min) throw new BadRequestException(`${field}: максимум меньше минимума`)
			return { min, max }
		}

		const cur = (await this.getLoadConfig()).current
		const next: AppLoadConfig = { ...cur }

		if (body.dailyVisitLimit != null) next.dailyVisitLimit = num(body.dailyVisitLimit, 'Лимит в день', 1, 500)
		if (body.dailyRampUp != null) {
			const raw = String(body.dailyRampUp).trim()
			const ok = raw.split(',').some(part => /^\d+\s*(?:-\s*\d+|\+)?\s*:\s*\d+$/.test(part.trim()))
			if (!ok) throw new BadRequestException('Разгон по дням: не разобрать. Пример: 1:6, 2:12, 3:20')
			next.dailyRampUp = raw
		}
		if (body.taskGapSec != null) next.taskGapSec = range(body.taskGapSec, 'Пауза между задачами', 30, 14400)
		if (body.captchaCooldownMin != null) next.captchaCooldownMin = range(body.captchaCooldownMin, 'Кулдаун после капчи', 1, 1440)
		if (body.phaseGapMs != null) next.phaseGapMs = range(body.phaseGapMs, 'Пауза между фазами', 200, 60000)
		if (body.paginationGapMs != null) next.paginationGapMs = range(body.paginationGapMs, 'Пауза после перелистывания', 200, 60000)

		await this.set(KEY_APP_LOAD_CONFIG, JSON.stringify(next))
		return this.getLoadConfig()
	}

	async getNetworkCapacityInfo() {
		const now = Date.now()
		if (this.capacityCache && this.capacityCache.expiresAt > now) {
			return this.capacityCache.value
		}

		// Приоритет: админ-override → дев-фикс → реальный расчёт по выполнениям.
		const override = parseInt(await this.get(KEY_NETWORK_ACTIVE_PCS, ''), 10)
		const isDev = process.env.NODE_ENV !== 'production'

		let activePcsWeek: number
		let avgPerDay: number
		if (Number.isFinite(override) && override > 0) {
			activePcsWeek = override
			avgPerDay = override
		} else if (isDev) {
			// В деве реально 1 ПК — фикс, чтобы видеть математику потолка.
			activePcsWeek = AppConfigService.DEV_FAKE_ACTIVE_PCS
			avgPerDay = AppConfigService.DEV_FAKE_ACTIVE_PCS
		} else {
			const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000)
			// Считаем по ВСЕМ выполнениям (любой статус, по createdAt) — COMPLETED-only
			// даёт замкнутый круг: мало выполнений → низкий cap → мало ПК получают задачи →
			// мало выполнений. Реальная ёмкость сети = число ACTIVE-установок.
			const [rows, activeInstalls] = await Promise.all([
				this.prisma.execution.findMany({
					where: { createdAt: { gte: weekAgo } },
					select: { executorId: true, createdAt: true },
				}),
				// Число ПК с активным приложением — источник правды для потолка выдачи
				this.prisma.user.count({
					where: { appStatus: { in: ['ACTIVE', 'REINSTALLED'] } },
				}),
			])
			// distinct активных ПК на каждый из дней → среднее в день за дни с данными
			const perDay = new Map<string, Set<string>>()
			const weekSet = new Set<string>()
			for (const r of rows) {
				if (!r.executorId) continue
				weekSet.add(r.executorId)
				const day = r.createdAt.toISOString().slice(0, 10)
				let set = perDay.get(day)
				if (!set) perDay.set(day, (set = new Set()))
				set.add(r.executorId)
			}
			const sumDaily = Array.from(perDay.values()).reduce((s, set) => s + set.size, 0)
			// Уникальных ПК за неделю — берём максимум из фактических и активных установок
			activePcsWeek = Math.max(weekSet.size, activeInstalls)
			// avgPerDay = активные установки (потенциал сети), не зависимо от выдачи задач.
			// Деление по фактическим дням (не всегда 7) устраняет занижение в начале работы.
			const avgFromActivity = perDay.size > 0 ? Math.round(sumDaily / perDay.size) : 0
			avgPerDay = Math.max(avgFromActivity, activeInstalls)
		}

		const maxPerDay = Math.max(
			1,
			Math.ceil(avgPerDay / AppConfigService.CAPACITY_SPREAD_DAYS),
		)
		const value = { activePcsWeek, avgPerDay, maxPerDay }
		this.capacityCache = { value, expiresAt: now + 5 * 60 * 1000 }
		return value
	}

	// Текущий override (null = не задан, считается авто)
	async getNetworkActivePcsOverride(): Promise<number | null> {
		const v = parseInt(await this.get(KEY_NETWORK_ACTIVE_PCS, ''), 10)
		return Number.isFinite(v) && v > 0 ? v : null
	}

	// Редактирование из админки. null/<=0 → сброс на авто. Кэш сбрасываем сразу.
	async setNetworkActivePcs(value: number | null) {
		await this.set(
			KEY_NETWORK_ACTIVE_PCS,
			value != null && value > 0 ? String(Math.round(value)) : '',
		)
		this.capacityCache = null
	}
}
