import { BadRequestException, Injectable } from '@nestjs/common'
import { randomBytes } from 'crypto'
import { PrismaService } from '../prisma/prisma.service'
import { buildOutreachMessage, MessageCompetitor } from './outreach-message'

// Импорт прогона парсера (yandex-leads → import.json).
// Ожидаемый вид тела запроса:
// {
//   "query": "купить голден гус", "region": "Москва",
//   "rows": [
//     { "keyword": "...", "domain": "site.ru", "position": 17, "url": "...", "title": "...",
//       "contacts": { "emails": [], "phones": [], "telegram": [], "whatsapp": [],
//                     "inn": [], "ogrn": [], "ogrnip": [] } }
//   ]
// }
// Строки ждём по ВСЕМУ топ-50: без позиций 9 и 10 не собрать конкурентов для текста.
// Лидов делаем только из окна positionMin..positionMax (по умолчанию 15–50).

export type SerpImportRow = {
	keyword?: string
	domain?: string
	position?: number | string
	url?: string
	title?: string
	region?: string
	contacts?: Record<string, any>
	// парсер может отдать контакты и плоско
	email?: string | string[]
	phone?: string | string[]
	telegram?: string | string[]
	whatsapp?: string | string[]
	inn?: string | string[]
	ogrn?: string | string[]
	ogrnip?: string | string[]
	companyName?: string
	city?: string
}

export type SerpImportPayload = {
	query?: string
	region?: string | number
	positionMin?: number
	positionMax?: number
	rows?: SerpImportRow[]
}

const DEFAULT_POSITION_MIN = 15
const DEFAULT_POSITION_MAX = 50
const COMPETITOR_POSITIONS = [9, 10]

type Row = { keyword: string; domain: string; position: number; url: string; title: string | null }

type Contacts = {
	email: string | null
	phone: string | null
	whatsapp: string | null
	telegram: string | null
	inn: string | null
	ogrn: string | null
	ogrnip: string | null
	companyName: string | null
	city: string | null
}

@Injectable()
export class OutreachImportService {
	constructor(private prisma: PrismaService) {}

	async importRun(payload: SerpImportPayload | SerpImportRow[], createdBy?: string) {
		const raw = Array.isArray(payload) ? payload : payload?.rows
		if (!Array.isArray(raw) || raw.length === 0) throw new BadRequestException('Нет строк выдачи')
		const body: SerpImportPayload = Array.isArray(payload) ? {} : payload

		const posMin = Number(body.positionMin) || DEFAULT_POSITION_MIN
		const posMax = Number(body.positionMax) || DEFAULT_POSITION_MAX

		// держим пару «сырая строка → нормализованная»: контакты лежат в сырой
		const pairs = raw
			.map(source => ({ source, row: normalizeRow(source) }))
			.filter((p): p is { source: SerpImportRow; row: Row } => p.row !== null)
		if (pairs.length === 0) throw new BadRequestException('Ни одной валидной строки выдачи')
		const rows = pairs.map(p => p.row)

		const keywords = Array.from(new Set(rows.map(r => r.keyword)))
		const query = body.query?.toString().trim() || keywords.slice(0, 5).join(', ')
		const region = body.region?.toString().trim() || raw.find(r => r?.region)?.region?.toString() || ''

		const imp = await this.prisma.serpImport.create({ data: { query, region, createdBy: createdBy ?? null } })
		await this.prisma.serpRow.createMany({
			data: rows.map(r => ({
				importId: imp.id,
				keyword: r.keyword,
				position: r.position,
				domain: r.domain,
				url: r.url,
				title: r.title,
			})),
		})

		// Кто стоит на 9 и 10 месте по каждому ключу — из этого потом собираем competitors.
		const rivals = new Map<string, MessageCompetitor[]>()
		for (const r of rows) {
			if (!COMPETITOR_POSITIONS.includes(r.position)) continue
			const list = rivals.get(r.keyword) ?? []
			list.push({ domain: r.domain, position: r.position })
			rivals.set(r.keyword, list)
		}
		for (const list of rivals.values()) list.sort((a, b) => a.position - b.position)

		// Группируем окно 15–50 по домену: один домен = один лид, сколько бы ключей он ни занял.
		const groups = new Map<string, { rows: Row[]; contacts: Contacts }>()
		for (const { source, row } of pairs) {
			if (row.position < posMin || row.position > posMax) continue
			const g = groups.get(row.domain) ?? { rows: [], contacts: emptyContacts() }
			g.rows.push(row)
			mergeContacts(g.contacts, pickContacts(source))
			groups.set(row.domain, g)
		}

		// Дедупликация по домену: старые лиды могли попасть в базу с www — ловим оба вида.
		const domains = Array.from(groups.keys())
		const existing = await this.prisma.outreachLead.findMany({
			where: { domain: { in: [...domains, ...domains.map(d => `www.${d}`)] } },
		})
		const existingByDomain = new Map(existing.map(l => [normalizeDomain(l.domain), l]))

		const toCreate: any[] = []
		let updated = 0

		for (const [domain, group] of groups) {
			const best = group.rows.reduce((a, b) => (a.position <= b.position ? a : b))
			// ключи лида: по одному на запрос, лучшие позиции первыми
			const leadKeywords = Array.from(
				group.rows
					.reduce((acc, r) => {
						const prev = acc.get(r.keyword)
						if (!prev || r.position < prev.position) acc.set(r.keyword, r)
						return acc
					}, new Map<string, Row>())
					.values(),
			).sort((a, b) => a.position - b.position)

			// конкуренты с 9 и 10 мест по ключам лида, дубли доменов убираем
			const competitors: MessageCompetitor[] = []
			const seen = new Set<string>()
			for (const k of leadKeywords) {
				for (const rival of rivals.get(k.keyword) ?? []) {
					if (rival.domain === domain || seen.has(rival.domain)) continue
					seen.add(rival.domain)
					competitors.push(rival)
				}
			}

			const prev = existingByDomain.get(domain)
			const c = group.contacts
			const contacts: Contacts = prev
				? {
					// руками заполненное в админке не затираем пустотой из парсера
					email: c.email ?? prev.email,
					phone: c.phone ?? prev.phone,
					whatsapp: c.whatsapp ?? prev.whatsapp,
					telegram: c.telegram ?? prev.telegram,
					inn: c.inn ?? prev.inn,
					ogrn: c.ogrn ?? prev.ogrn,
					ogrnip: c.ogrnip ?? prev.ogrnip,
					companyName: c.companyName ?? prev.companyName,
					city: c.city ?? prev.city,
				}
				: c

			const reportToken = prev?.reportToken ?? newReportToken()
			const score = scoreLead({
				keywordsCount: leadKeywords.length,
				bestPosition: best.position,
				posMin,
				posMax,
				contacts,
			})
			const message = buildOutreachMessage({
				domain,
				firstName: prev?.firstName,
				middleName: prev?.middleName,
				keywords: leadKeywords.map(k => ({ keyword: k.keyword, position: k.position })),
				competitors,
				reportUrl: reportUrl(reportToken),
			})

			const data = {
				// у лида из старого импорта домен мог лежать как «www.site.ru» —
				// приводим к нормальному виду, иначе он не сойдётся с serp_rows
				domain,
				// токен пишем и существующему лиду: он уже вставлен в текст сообщения,
				// а у старых лидов его могло не быть вовсе — иначе ссылка ведёт в никуда
				reportToken,
				importId: imp.id,
				...contacts,
				contact: mainContact(contacts),
				channel: mainChannel(contacts),
				keywords: leadKeywords.map(k => `${k.keyword} — ${k.position}`).join('; '),
				keywordsCount: leadKeywords.length,
				bestPosition: best.position,
				score,
				competitors: competitors as any,
				message,
			}

			if (prev) {
				await this.prisma.outreachLead.update({ where: { id: prev.id }, data })
				updated++
			} else {
				toCreate.push(data)
			}
		}

		if (toCreate.length > 0) await this.prisma.outreachLead.createMany({ data: toCreate })

		await this.prisma.serpImport.update({
			where: { id: imp.id },
			data: { rowsCount: rows.length, leadsCount: groups.size },
		})

		return {
			importId: imp.id,
			query,
			region,
			rowsCount: rows.length,
			leadsCount: groups.size,
			created: toCreate.length,
			updated,
		}
	}

	async listImports() {
		return this.prisma.serpImport.findMany({ orderBy: { createdAt: 'desc' }, take: 200 })
	}
}

// ─────────────────────────────────────────────────────────────────────────────

// Скоринг 0–100. Смысл: кого дешевле поднять и с кем есть чем говорить.
//   ширина семантики — до 40: чем по большему числу ключей лид уже виден, тем он
//                             ценнее; 10 ключей и больше = максимум
//   лучшая позиция   — до 35: 15-е место = 35, 50-е = 0. Ближе к топ-10 — короче путь
//   контакты         — до 20: прямой канал (tg/wa) 10, телефон 5, email 5 —
//                             без контакта лид не отработать вообще
//   реквизиты        —     5: есть ИНН/ОГРН — компания опознана, разговор предметный
// Считаем по текущему прогону: позиции живые, старые цифры переписываем.
export function scoreLead(input: {
	keywordsCount: number
	bestPosition: number | null
	posMin: number
	posMax: number
	contacts: Pick<Contacts, 'telegram' | 'whatsapp' | 'phone' | 'email' | 'inn' | 'ogrn' | 'ogrnip'>
}): number {
	const breadth = (Math.min(input.keywordsCount, 10) / 10) * 40

	const span = Math.max(input.posMax - input.posMin, 1)
	const closeness =
		input.bestPosition === null ? 0 : clamp((input.posMax - input.bestPosition) / span, 0, 1) * 35

	const c = input.contacts
	let contacts = 0
	if (c.telegram || c.whatsapp) contacts += 10
	if (c.phone) contacts += 5
	if (c.email) contacts += 5

	const requisites = c.inn || c.ogrn || c.ogrnip ? 5 : 0

	return Math.round(clamp(breadth + closeness + contacts + requisites, 0, 100))
}

export function reportUrl(token: string | null | undefined): string | null {
	if (!token) return null
	// Короткий /r/:token заработает, когда в nginx появится отдельный location;
	// пока публичная ссылка живёт под общим префиксом бэкенда.
	const base =
		process.env.OUTREACH_REPORT_BASE_URL || `${process.env.FRONTEND_URL || 'https://skyseo.site'}/v1/api/r`
	return `${base.replace(/\/+$/, '')}/${token}`
}

export function newReportToken(): string {
	return randomBytes(8).toString('base64url')
}

export function normalizeDomain(raw: string): string {
	return raw
		.trim()
		.toLowerCase()
		.replace(/^https?:\/\//, '')
		.replace(/^www\./, '')
		.replace(/\/.*$/, '')
}

function clamp(v: number, min: number, max: number): number {
	return Math.min(Math.max(v, min), max)
}

function normalizeRow(row: SerpImportRow): Row | null {
	if (!row) return null
	const domain = normalizeDomain(row.domain?.toString() ?? '')
	const keyword = row.keyword?.toString().trim() ?? ''
	const position = Number(row.position)
	if (!domain || !keyword || !Number.isFinite(position) || position <= 0) return null
	return {
		domain,
		keyword,
		position: Math.trunc(position),
		url: row.url?.toString().trim() || `https://${domain}`,
		title: row.title?.toString().trim() || null,
	}
}

function emptyContacts(): Contacts {
	return {
		email: null,
		phone: null,
		whatsapp: null,
		telegram: null,
		inn: null,
		ogrn: null,
		ogrnip: null,
		companyName: null,
		city: null,
	}
}

// Парсер отдаёт списки (первые несколько найденных значений). Контакты склеиваем,
// реквизиты берём первым значением: в схеме это одно поле.
function pickContacts(row: SerpImportRow): Contacts {
	const c = row?.contacts ?? {}
	return {
		email: join(c.emails ?? c.email ?? row?.email),
		phone: join(c.phones ?? c.phone ?? row?.phone),
		whatsapp: join(c.whatsapp ?? row?.whatsapp),
		telegram: join(c.telegram ?? row?.telegram),
		inn: first(c.inn ?? row?.inn),
		ogrn: first(c.ogrn ?? row?.ogrn),
		ogrnip: first(c.ogrnip ?? row?.ogrnip),
		companyName: first(c.companyName ?? c.company_name ?? row?.companyName),
		city: first(c.city ?? row?.city),
	}
}

function mergeContacts(target: Contacts, add: Contacts): void {
	for (const key of Object.keys(target) as (keyof Contacts)[]) {
		if (!target[key] && add[key]) target[key] = add[key]
	}
}

function join(v: unknown, limit = 3): string | null {
	const list = (Array.isArray(v) ? v : [v])
		.map(x => x?.toString().trim())
		.filter((x): x is string => !!x)
	return list.length > 0 ? list.slice(0, limit).join(', ') : null
}

function first(v: unknown): string | null {
	const list = (Array.isArray(v) ? v : [v])
		.map(x => x?.toString().trim())
		.filter((x): x is string => !!x)
	return list[0] ?? null
}

function mainContact(c: Contacts): string | null {
	return c.telegram ?? c.whatsapp ?? c.phone ?? c.email ?? null
}

function mainChannel(c: Contacts): string {
	if (c.telegram) return 'Telegram'
	if (c.whatsapp) return 'WhatsApp'
	if (c.phone) return 'Телефон'
	if (c.email) return 'Email'
	return '—'
}
