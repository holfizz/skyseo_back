// Проверка позиций сайта в Яндексе через XMLRiver (реселлер Яндекс.XML).
// Один запрос = один ключ = топ-100 выдачи за одну проверку (~1.2 коп по тарифу XMLRiver).

const XMLRIVER_YANDEX = 'https://xmlriver.com/search_yandex/xml'

// Город → код региона Яндекса (lr). Покрываем крупные города; остальное — Москва по умолчанию.
const CITY_LR: Record<string, number> = {
	'москва': 213, 'мск': 213,
	'санкт-петербург': 2, 'спб': 2, 'питер': 2, 'петербург': 2,
	'новосибирск': 65,
	'екатеринбург': 54,
	'казань': 43,
	'нижний новгород': 47,
	'челябинск': 56,
	'самара': 51,
	'омск': 66,
	'ростов-на-дону': 39, 'ростов': 39,
	'уфа': 172,
	'красноярск': 62,
	'воронеж': 193,
	'пермь': 50,
	'волгоград': 38,
	'краснодар': 35,
	'саратов': 194,
	'тюмень': 55,
	'тольятти': 240,
	'ижевск': 44,
	'барнаул': 197,
	'ульяновск': 195,
	'иркутск': 63,
	'хабаровск': 76,
	'ярославль': 16,
	'владивосток': 75,
	'махачкала': 28,
	'томск': 67,
	'оренбург': 48,
	'кемерово': 64,
	'новокузнецк': 237,
	'рязань': 11,
	'астрахань': 37,
	'пенза': 49,
	'липецк': 9,
	'тула': 15,
	'киров': 46,
	'чебоксары': 45,
	'калининград': 22,
	'курск': 8,
	'сочи': 239,
	'ставрополь': 36,
	'белгород': 4,
	'сургут': 973,
	'россия': 225,
}

const DEFAULT_LR = 225 // вся Россия — если регион не указан (федеральная выдача, без привязки к городу)
const DEFAULT_CITY = 'вся Россия'

// Город (строкой) → регион Яндекса. Пусто = вся Россия. Число трактуем как готовый код lr.
export function resolveRegion(city?: string): { lr: number; city: string } {
	const raw = (city || '').trim()
	if (!raw) return { lr: DEFAULT_LR, city: DEFAULT_CITY }
	if (/^\d+$/.test(raw)) return { lr: Number(raw), city: `регион ${raw}` }
	const lr = CITY_LR[raw.toLowerCase()]
	if (lr) return { lr, city: raw }
	return { lr: DEFAULT_LR, city: `${DEFAULT_CITY} (город «${raw}» не распознан)` }
}

function decodeEntities(s: string): string {
	return s
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#0*39;/g, "'")
		.replace(/&apos;/g, "'")
}

// Хост без www в нижнем регистре; терпимо к URL без схемы и с мусором.
export function hostOf(u: string): string {
	const s = (u || '').trim()
	try {
		return new URL(s.includes('://') ? s : 'http://' + s).hostname.replace(/^www\./i, '').toLowerCase()
	} catch {
		return s.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0].toLowerCase()
	}
}

// Совпадение домена: точное или поддомен целевого (blog.site.ru ⊂ site.ru).
function isMatch(target: string, result: string): boolean {
	if (!target || !result) return false
	return result === target || result.endsWith('.' + target)
}

// URL всех органических doc в порядке выдачи (позиция = индекс + 1).
export function parseResultUrls(xml: string): string[] {
	const urls: string[] = []
	const docRe = /<doc\b[\s\S]*?<\/doc>/g
	const urlRe = /<url>([\s\S]*?)<\/url>/
	let m: RegExpExecArray | null
	while ((m = docRe.exec(xml))) {
		const um = urlRe.exec(m[0])
		if (um) urls.push(decodeEntities(um[1].trim()))
	}
	return urls
}

// Текст ошибки из ответа XMLRiver/Яндекс.XML, если он есть (неверный ключ, нет баланса и т.п.).
export function parseError(xml: string): string | null {
	const m = /<error\b[^>]*>([\s\S]*?)<\/error>/.exec(xml)
	return m ? decodeEntities(m[1].trim()) : null
}

export type PositionResult = { keyword: string; position: number | null; url: string | null; error?: string }

// Яндекс-API XMLRiver отдаёт максимум 10 результатов за запрос — топ-50/100 набираем пагинацией.
const RESULTS_PER_PAGE = 10

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// Временная перегрузка XMLRiver: «нет свободных каналов», «попробуйте позже» — можно повторить.
function isBusy(msg: string): boolean {
	return /канал|попробуйте позже|повторите|too many|busy/i.test(msg)
}

// Запросить одну страницу выдачи с ретраями на временную перегрузку канала.
async function fetchPage(u: string): Promise<{ xml?: string; error?: string }> {
	for (let attempt = 0; attempt < 4; attempt++) {
		try {
			const res = await fetch(u)
			const body = await res.text()
			if (!res.ok) {
				if ((res.status >= 500 || res.status === 429) && attempt < 3) { await sleep(1200 * (attempt + 1)); continue }
				return { error: `HTTP ${res.status}` }
			}
			const err = parseError(body)
			if (err && isBusy(err) && attempt < 3) { await sleep(1200 * (attempt + 1)); continue }
			if (err) return { error: err }
			return { xml: body }
		} catch {
			if (attempt < 3) { await sleep(1000 * (attempt + 1)); continue }
			return { error: 'сеть недоступна' }
		}
	}
	return { error: 'канал занят, попробуйте позже' }
}

// scanned — сколько результатов реально просмотрели (для честного «вне топ-N»).
// Ранний выход: как только нашли домен — дальше страницы не запрашиваем (не платим).
async function checkOne(
	base: { user: string; key: string; lr: number },
	domainHost: string,
	keyword: string,
	maxPages: number,
): Promise<PositionResult & { scanned: number }> {
	let scanned = 0
	for (let page = 0; page < maxPages; page++) {
		const url = new URL(XMLRIVER_YANDEX)
		url.searchParams.set('user', base.user)
		url.searchParams.set('key', base.key)
		url.searchParams.set('query', keyword)
		url.searchParams.set('groupby', '10')
		url.searchParams.set('page', String(page))
		url.searchParams.set('domain', 'ru')
		url.searchParams.set('lang', 'ru')
		url.searchParams.set('lr', String(base.lr))

		const { xml, error } = await fetchPage(url.toString())
		if (error) return { keyword, position: null, url: null, error, scanned }

		const urls = parseResultUrls(xml!)
		if (urls.length === 0) break // результаты кончились
		for (let i = 0; i < urls.length; i++) {
			if (isMatch(domainHost, hostOf(urls[i]))) {
				return { keyword, position: page * RESULTS_PER_PAGE + i + 1, url: urls[i], scanned: scanned + i + 1 }
			}
		}
		scanned += urls.length
		if (urls.length < RESULTS_PER_PAGE) break // это была последняя страница выдачи
	}
	return { keyword, position: null, url: null, scanned } // не нашли в просмотренной глубине
}

// Простой пул с ограничением параллелизма — не бомбим XMLRiver десятками запросов сразу.
async function mapPool<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
	const out: R[] = new Array(items.length)
	let i = 0
	const worker = async () => {
		while (i < items.length) {
			const idx = i++
			out[idx] = await fn(items[idx])
		}
	}
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
	return out
}

export async function checkYandexPositions(opts: {
	user: string
	key: string
	domain: string
	keywords: string[]
	lr: number
	topN?: number
	concurrency?: number
}): Promise<{ results: PositionResult[]; depth: number }> {
	const domainHost = hostOf(opts.domain)
	const topN = opts.topN && opts.topN > 0 ? opts.topN : 50
	const maxPages = Math.max(1, Math.ceil(topN / RESULTS_PER_PAGE))
	// Мало каналов на аккаунте XMLRiver — параллелим осторожно (2), перегрузку добираем ретраями.
	const concurrency = opts.concurrency && opts.concurrency > 0 ? opts.concurrency : 2
	const raw = await mapPool(opts.keywords, concurrency, kw =>
		checkOne({ user: opts.user, key: opts.key, lr: opts.lr }, domainHost, kw, maxPages),
	)
	// Глубина «вне топ-N» = реальное число просмотренных результатов.
	const depth = raw.reduce((m, r) => Math.max(m, r.scanned), 0) || topN
	const results = raw.map(({ scanned, ...r }) => r)
	return { results, depth }
}

// ——— Частотность Wordstat (объём спроса по ключу) ———
// Широкое соответствие, вся Россия (регион не задаём). Ответ — JSON, частота фразы в .popular.

const XMLRIVER_WORDSTAT = 'https://xmlriver.com/wordstat/new/json'

async function fetchWordstatOne(
	user: string,
	key: string,
	keyword: string,
): Promise<{ value: number | null; error?: string }> {
	const u = new URL(XMLRIVER_WORDSTAT)
	u.searchParams.set('user', user)
	u.searchParams.set('key', key)
	u.searchParams.set('query', keyword)
	for (let attempt = 0; attempt < 4; attempt++) {
		try {
			const res = await fetch(u.toString())
			const text = await res.text()
			if (!res.ok) {
				if ((res.status >= 500 || res.status === 429) && attempt < 3) { await sleep(1200 * (attempt + 1)); continue }
				return { value: null, error: `HTTP ${res.status}` }
			}
			let j: any
			try { j = JSON.parse(text) } catch { return { value: null, error: 'плохой ответ' } }
			const errMsg = j?.error || (j?.errors ? JSON.stringify(j.errors) : '')
			if (errMsg) {
				if (isBusy(String(errMsg)) && attempt < 3) { await sleep(1200 * (attempt + 1)); continue }
				return { value: null, error: String(errMsg).slice(0, 80) }
			}
			// popular[] — фразы, содержащие запрос; частота самого запроса = точное совпадение, иначе верхняя.
			const pop: any[] = Array.isArray(j?.popular) ? j.popular : []
			const exact = pop.find(p => (p?.text || '').trim().toLowerCase() === keyword.trim().toLowerCase())
			const v = exact ? Number(exact.value) : pop[0] ? Number(pop[0].value) : 0
			return { value: Number.isFinite(v) ? v : null }
		} catch {
			if (attempt < 3) { await sleep(1000 * (attempt + 1)); continue }
			return { value: null, error: 'сеть недоступна' }
		}
	}
	return { value: null, error: 'канал занят, попробуйте позже' }
}

export async function getWordstatVolumes(opts: {
	user: string
	key: string
	keywords: string[]
	concurrency?: number
}): Promise<Map<string, { value: number | null; error?: string }>> {
	const concurrency = opts.concurrency && opts.concurrency > 0 ? opts.concurrency : 3
	const map = new Map<string, { value: number | null; error?: string }>()
	await mapPool(opts.keywords, concurrency, async kw => {
		map.set(kw, await fetchWordstatOne(opts.user, opts.key, kw))
	})
	return map
}

// ——— Всё вместе: объём (Wordstat) + позиция (Яндекс) по каждому ключу ———
export type KeywordRow = {
	keyword: string
	volume: number | null
	position: number | null
	url: string | null
	error?: string
}

export async function checkKeywords(opts: {
	user: string
	key: string
	domain: string
	keywords: string[]
	lr: number
	topN?: number
	concurrency?: number
}): Promise<{ depth: number; results: KeywordRow[] }> {
	// Двумя фазами (сначала объёмы, потом позиции), чтобы не удваивать нагрузку на каналы XMLRiver.
	const volumes = await getWordstatVolumes({ user: opts.user, key: opts.key, keywords: opts.keywords })
	const { results: pos, depth } = await checkYandexPositions({
		user: opts.user,
		key: opts.key,
		domain: opts.domain,
		keywords: opts.keywords,
		lr: opts.lr,
		topN: opts.topN,
		concurrency: opts.concurrency,
	})
	const results: KeywordRow[] = pos.map(p => {
		const v = volumes.get(p.keyword)
		return {
			keyword: p.keyword,
			volume: v?.value ?? null,
			position: p.position,
			url: p.url,
			error: p.error || v?.error,
		}
	})
	return { depth, results }
}

// Баланс аккаунта XMLRiver в рублях (для плашки и подсчёта стоимости по дельте). null если не удалось.
export async function getXmlriverBalance(user: string, key: string): Promise<number | null> {
	if (!user || !key) return null
	const ctrl = new AbortController()
	const timer = setTimeout(() => ctrl.abort(), 8000) // не подвешиваем проверку, если баланс-эндпоинт тупит
	try {
		const u = `https://xmlriver.com/api/get_balance/?user=${encodeURIComponent(user)}&key=${encodeURIComponent(key)}`
		const res = await fetch(u, { signal: ctrl.signal })
		if (!res.ok) return null
		const text = (await res.text()).trim()
		const n = Number(text.replace(',', '.').replace(/[^\d.\-]/g, ''))
		return Number.isFinite(n) ? n : null
	} catch {
		return null
	} finally {
		clearTimeout(timer)
	}
}
