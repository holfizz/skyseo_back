import { Injectable, NotFoundException } from '@nestjs/common'
import { AppConfigService } from '../app-config/app-config.service'
import { OutreachLead } from '@prisma/client'
import { domainToUnicode } from 'node:url'
import { PrismaService } from '../prisma/prisma.service'
import { renderPdf } from './report.pdf'
import { renderReportHtml } from './report.template'
import { ReportCompetitor, ReportData, ReportKeyword } from './report.types'
import { getWordstatVolumes, resolveRegion } from '../common/yandex-positions'


// Всегда ASCII: по этому виду домены лежат в serp_rows и по нему же сверяются.
function normalizeDomain(raw: string): string {
	return raw
		.trim()
		.toLowerCase()
		.replace(/^https?:\/\//, '')
		.replace(/^www\./, '')
		.replace(/\/.*$/, '')
}

// Только для показа: «xn----ctbrxdbmo4cd0b.xn--p1ai» в отчёте выглядит мусором.
// Сравнения и дедуп остаются на ASCII-виде, иначе кириллический домен не найдётся в базе.
function displayDomain(host: string): string {
	return host.includes('xn--') ? domainToUnicode(host) || host : host
}

// Сервисы самого Яндекса и его карты стоят в выдаче по своим правилам: подниматься
// «выше Яндекса в Яндексе» нельзя, и в списке конкурентов они только путают.
const OWN_SERVICES = /(^|\.)(yandex\.(ru|by|kz|com)|ya\.ru)$/

function isRealCompetitor(domain: string): boolean {
	return !OWN_SERVICES.test(domain)
}

function safeUrl(url: unknown): string | null {
	if (typeof url !== 'string' || !url) return null
	try {
		const parsed = new URL(url)
		return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : null
	} catch {
		return null
	}
}

// Обращение по правилам заказчика: «Имя Отчество», иначе «Имя», иначе без обращения.
function buildAddressee(lead: OutreachLead): string | null {
	const first = lead.firstName?.trim()
	if (!first) return null
	const middle = lead.middleName?.trim()
	return middle ? `${first} ${middle}` : first
}

// competitors — Json без жёсткой схемы (его наполняет импорт выдачи).
// Принимаем и «по ключам», и плоский список; плоский кладём под ключ '*'.
function parseCompetitorsJson(raw: unknown): Map<string, ReportCompetitor[]> {
	const byKeyword = new Map<string, ReportCompetitor[]>()
	if (!Array.isArray(raw)) return byKeyword
	const flat: ReportCompetitor[] = []
	for (const item of raw) {
		if (!item || typeof item !== 'object') continue
		const node = item as Record<string, unknown>
		const nested = node.top ?? node.competitors ?? node.rows ?? node.domains
		if (typeof node.keyword === 'string' && Array.isArray(nested)) {
			const list = nested.map(toCompetitor).filter((c): c is ReportCompetitor => c !== null)
			if (list.length) byKeyword.set(node.keyword.trim(), list)
			continue
		}
		const single = toCompetitor(node)
		if (single) flat.push(single)
	}
	if (flat.length) byKeyword.set('*', flat)
	return byKeyword
}

function toCompetitor(value: unknown): ReportCompetitor | null {
	if (typeof value === 'string') {
		const domain = normalizeDomain(value)
		return domain ? { position: 0, domain: displayDomain(domain), url: `https://${domain}` } : null
	}
	if (!value || typeof value !== 'object') return null
	const node = value as Record<string, unknown>
	if (typeof node.domain !== 'string') return null
	const domain = normalizeDomain(node.domain)
	if (!domain) return null
	const position = Number(node.position)
	return {
		position: Number.isFinite(position) ? position : 0,
		domain: displayDomain(domain),
		url: safeUrl(node.url) ?? `https://${domain}`,
	}
}

// Запасной путь для лидов без importId (старые импорты из xlsx):
// keywords там свободный текст вида «купить кроссовки — 23 место».
function parseKeywordsText(text: string | null): { keyword: string; position: number | null }[] {
	if (!text) return []
	return text
		.split(/[\n;]+/)
		.map(line => line.trim())
		.filter(Boolean)
		.map(line => {
			const match =
				line.match(/^(.+?)\s*[—–:-]?\s*(\d{1,3})\s*мест[оа]?$/i) ??
				line.match(/^(.+?)\s*[—–:-]\s*(\d{1,3})$/)
			const keyword = (match ? match[1] : line).replace(/^[«"']+|[»"']+$/g, '').trim()
			return { keyword, position: match ? Number(match[2]) : null }
		})
		.filter(item => item.keyword.length > 0)
}

// Рендер разбора по лиду. Ссылку, токен и счётчик открытий держит OutreachService —
// сюда лид приходит уже найденным по токену (см. outreach/report.controller.ts).
@Injectable()
export class ReportService {
	constructor(
		private prisma: PrismaService,
		private appConfig: AppConfigService,
	) {}

	async renderPdf(leadId: string): Promise<Buffer> {
		return renderPdf(await this.renderHtml(leadId))
	}

	private async renderHtml(leadId: string): Promise<string> {
		const lead = await this.prisma.outreachLead.findUnique({ where: { id: leadId } })
		if (!lead) throw new NotFoundException('Лид не найден')
		return renderReportHtml(await this.buildData(lead))
	}

	private async buildData(lead: OutreachLead): Promise<ReportData> {
		const fromSerp = lead.importId ? await this.keywordsFromSerp(lead.importId, lead.domain) : []
		const keywords = fromSerp.length ? fromSerp : this.keywordsFromLeadFields(lead)
		const imp = lead.importId
			? await this.prisma.serpImport.findUnique({
					where: { id: lead.importId },
					select: { region: true },
				})
			: null
		return {
			domain: displayDomain(normalizeDomain(lead.domain)),
			companyName: lead.companyName ?? null,
			addressee: buildAddressee(lead),
			keywords: await this.withVolumes(keywords, imp?.region ?? null),
			region: imp?.region ?? null,
			// Цену тянем из настроек, а не хардкодим: менеджер поднимает ценник
			// в админке, и следующий же отчёт печатается с новой суммой.
			priceFrom: (await this.appConfig.getReportPrice()).price,
			generatedAt: new Date(),
		}
	}

	/**
	 * Поисковый объём по Вордстату. Регион берём тот же, по которому снимали выдачу —
	 * иначе рядом окажутся московские позиции и всероссийская частотность.
	 *
	 * Ошибки не роняют отчёт: без ключей XMLRiver или при сбое канала объём
	 * остаётся null и колонка просто не показывается. Отчёт важнее цифры.
	 */
	private async withVolumes(keywords: ReportKeyword[], region: string | null): Promise<ReportKeyword[]> {
		const user = process.env.XMLRIVER_USER
		const key = process.env.XMLRIVER_KEY
		if (!user || !key || keywords.length === 0) return keywords
		try {
			const volumes = await getWordstatVolumes({
				user,
				key,
				keywords: keywords.map(k => k.keyword),
				lr: resolveRegion(region ?? undefined).lr,
			})
			return keywords.map(k => ({ ...k, volume: volumes.get(k.keyword)?.value ?? null }))
		} catch {
			return keywords
		}
	}

	// Основной источник: сохранённый топ-50 того прогона, из которого пришёл лид.
	private async keywordsFromSerp(importId: string, domain: string): Promise<ReportKeyword[]> {
		const target = normalizeDomain(domain)
		const own = await this.prisma.serpRow.findMany({
			where: {
				importId,
				OR: [
					{ domain: { equals: target, mode: 'insensitive' } },
					{ domain: { equals: `www.${target}`, mode: 'insensitive' } },
				],
			},
			select: { keyword: true, position: true },
			orderBy: { position: 'asc' },
		})
		if (!own.length) return []

		// Раньше брали только 9 и 10 места. Теперь — ВСЕХ, кто стоит выше лида:
		// у сайта на 50-м месте это до 49 доменов, и именно они показывают
		// масштаб отставания. Отсечка по позиции лида делается ниже, в памяти,
		// потому что у каждого ключа своя позиция.
		const rivals = await this.prisma.serpRow.findMany({
			where: {
				importId,
				keyword: { in: [...new Set(own.map(row => row.keyword))] },
			},
			select: { keyword: true, position: true, domain: true, url: true },
			orderBy: { position: 'asc' },
		})
		// Один ключ мог встретиться дважды (сайт на нескольких url) — берём лучшую позицию.
		const best = new Map<string, number>()
		for (const row of own) {
			const current = best.get(row.keyword)
			if (current === undefined || row.position < current) best.set(row.keyword, row.position)
		}

		const rivalsByKeyword = new Map<string, ReportCompetitor[]>()
		const seen = new Map<string, Set<string>>() // ключ → домены, чтобы не дублировать
		for (const row of rivals) {
			const ownPos = best.get(row.keyword)
			if (ownPos === undefined || row.position >= ownPos) continue // ниже нас — не конкурент
			const rivalDomain = normalizeDomain(row.domain)
			if (rivalDomain === target || !isRealCompetitor(rivalDomain)) continue
			const dedupe = seen.get(row.keyword) ?? new Set<string>()
			if (dedupe.has(rivalDomain)) continue // один домен на нескольких url
			dedupe.add(rivalDomain)
			seen.set(row.keyword, dedupe)
			const list = rivalsByKeyword.get(row.keyword) ?? []
			list.push({
				position: row.position,
				domain: displayDomain(rivalDomain),
				url: safeUrl(row.url) ?? `https://${rivalDomain}`,
			})
			rivalsByKeyword.set(row.keyword, list)
		}

		return [...best.entries()]
			.map(([keyword, position]) => ({
				keyword,
				position,
				competitors: rivalsByKeyword.get(keyword) ?? [],
				volume: null as number | null, // проставляется в withVolumes
			}))
			.sort((a, b) => a.position - b.position)
	}

	private keywordsFromLeadFields(lead: OutreachLead): ReportKeyword[] {
		const competitors = parseCompetitorsJson(lead.competitors)
		const shared = competitors.get('*') ?? []
		return parseKeywordsText(lead.keywords).map(item => ({
			keyword: item.keyword,
			position: item.position,
			competitors: competitors.get(item.keyword) ?? shared,
			volume: null as number | null, // проставляется в withVolumes
		}))
	}
}
