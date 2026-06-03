import { BadRequestException, Injectable } from '@nestjs/common'
import OpenAI from 'openai'
import { PrismaService } from '../prisma/prisma.service'

interface PageContent {
	url: string
	title: string
	description: string
	h1: string[]
	h2: string[]
}

interface KeywordSuggestion {
	keyword: string
	competition: number
	keyword_type: 'primary' | 'secondary' | 'long_tail' | 'informational' | 'commercial'
	reason: string
}

interface AnalyzedPage {
	url: string
	title: string
	keywords: KeywordSuggestion[]
}

export interface AnalyzeResult {
	site: {
		topic: string
		language: string
		warning: boolean
		reject_site: boolean
		reject_reason?: string
	}
	pages: AnalyzedPage[]
	sitemapPages: string[]
}

const FORBIDDEN_URL_PATTERNS = [
	'porn', 'sex', 'xxx', 'erotic', 'adult', 'casino', 'betting',
	'escort', 'слот', 'ставки', 'казино',
]

@Injectable()
export class AiService {
	private openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

	constructor(private prisma: PrismaService) {}

	// Fallback для consent-окна Google: приложение шлёт ПОЧИЩЕННЫЙ HTML модалки (без стилей/скриптов/svg
	// и лишних атрибутов) + список кликабельных элементов с индексами. Модель решает — это окно согласия
	// и на какой индекс нажать «Принять». Дёшево (текст, без vision), fail-safe: при ошибке — «не consent».
	async resolveConsent(
		html: string,
		candidates: { i: number; text: string }[],
	): Promise<{ isConsent: boolean; clickIndex: number | null }> {
		const list = (candidates || []).slice(0, 40).map(c => `${c.i}: ${c.text}`).join('\n')
		const clipped = (html || '').slice(0, 8000)
		try {
			const response = await this.openai.chat.completions.create({
				model: 'gpt-5-mini-2025-08-07',
				temperature: 0,
				max_completion_tokens: 60,
				messages: [
					{
						role: 'system',
						content:
							'Тебе дан упрощённый HTML модального окна со страницы Google + список кликабельных элементов с индексами. ' +
							'Определи, это ли блокирующее окно согласия на cookie / «Прежде чем перейти к Google» / GDPR-баннер, ' +
							'мешающее попасть на результаты поиска. Если да — верни индекс кнопки, которая ПРИНИМАЕТ/соглашается/' +
							'продолжает (предпочитай «принять все»/«accept all», не «отклонить»). ' +
							'Ответь строго JSON: {"isConsent": boolean, "clickIndex": number|null}. ' +
							'Если это обычная выдача, а не окно согласия — {"isConsent": false, "clickIndex": null}.',
					},
					{
						role: 'user',
						content: `HTML:\n${clipped}\n\nКликабельные элементы:\n${list}`,
					},
				],
				response_format: { type: 'json_object' },
			})
			const raw = response.choices[0]?.message?.content
			if (!raw) return { isConsent: false, clickIndex: null }
			const parsed = JSON.parse(raw)
			return {
				isConsent: !!parsed.isConsent,
				clickIndex: typeof parsed.clickIndex === 'number' ? parsed.clickIndex : null,
			}
		} catch (e) {
			console.error('[AiService] resolveConsent error:', (e as Error).message)
			return { isConsent: false, clickIndex: null }
		}
	}

	async analyzeSite(url: string, context?: string, userId?: string): Promise<AnalyzeResult> {
		const siteUrl = this.normalizeUrl(url)

		// Check forbidden URL
		const urlLower = siteUrl.toLowerCase()
		for (const pattern of FORBIDDEN_URL_PATTERNS) {
			if (urlLower.includes(pattern)) {
				return {
					site: { topic: '', language: 'ru', warning: false, reject_site: true, reject_reason: 'Сайт не может быть добавлен' },
					pages: [],
					sitemapPages: [],
				}
			}
		}

		// Сначала быстрая проверка — существует ли сайт вообще
		await this.assertSiteReachable(siteUrl)

		// Fetch main page + indexing check + sitemap in parallel
		const [mainPage, warning, sitemapPages] = await Promise.all([
			this.fetchPageContent(siteUrl).catch(() => null),
			this.checkIndexingWarning(siteUrl),
			this.getSitemapUrls(siteUrl).catch(() => [] as string[]),
		])

		// Fetch content for top inner pages to give GPT real signal
		const innerUrls = sitemapPages
			.filter(u => u !== siteUrl && !u.endsWith('.xml'))
			.slice(0, 4)
		const innerPages = await Promise.all(
			innerUrls.map(u => this.fetchPageContent(u).catch(() => null))
		).then(pages => pages.filter(Boolean) as PageContent[])

		const prompt = this.buildPrompt(siteUrl, mainPage, sitemapPages, innerPages, context)

		try {
			const response = await this.openai.chat.completions.create({
				model: 'gpt-4o-mini',
				messages: [{ role: 'user', content: prompt }],
				response_format: { type: 'json_object' },
				max_tokens: 4000,
				temperature: 0.3,
			})

			const raw = response.choices[0]?.message?.content
			if (!raw) throw new Error('Empty response from OpenAI')

			const parsed = JSON.parse(raw) as AnalyzeResult
			parsed.site.warning = warning
			parsed.sitemapPages = sitemapPages.slice(0, 50)

			if (userId) {
				this.prisma.user.update({
					where: { id: userId },
					data: { aiAnalysesCount: { increment: 1 } },
				}).catch(() => {})
			}

			return parsed
		} catch (err) {
			throw new BadRequestException('Ошибка анализа сайта через AI: ' + (err as Error).message)
		}
	}

	private async assertSiteReachable(siteUrl: string): Promise<void> {
		if (process.env.NODE_ENV !== 'production') return
		const controller = new AbortController()
		const timeout = setTimeout(() => controller.abort(), 6000)
		try {
			const res = await fetch(siteUrl, {
				method: 'HEAD',
				signal: controller.signal,
				headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SkySEO-Bot/1.0)' },
			})
			// 4xx клиентские ошибки (кроме 404) могут быть редиректами или защитой — пропускаем
			// 404 и 5xx — сайт не работает
			if (res.status === 404 || res.status >= 500) {
				throw new BadRequestException(
					`Сайт недоступен (HTTP ${res.status}). Проверьте URL и убедитесь, что сайт работает.`,
				)
			}
		} catch (err) {
			if (err instanceof BadRequestException) throw err
			throw new BadRequestException(
				'Сайт не отвечает. Проверьте правильность URL и убедитесь, что сайт работает.',
			)
		} finally {
			clearTimeout(timeout)
		}
	}

	async getSitemapUrls(siteUrl: string): Promise<string[]> {
		const base = this.normalizeUrl(siteUrl)

		// Try common sitemap locations
		const candidates = [
			`${base}/sitemap.xml`,
			`${base}/sitemap_index.xml`,
			`${base}/sitemap/sitemap.xml`,
		]

		// Also check robots.txt for sitemap
		try {
			const robots = await this.fetchText(`${base}/robots.txt`)
			const match = robots.match(/Sitemap:\s*(\S+)/i)
			if (match) candidates.unshift(match[1])
		} catch {}

		for (const url of candidates) {
			try {
				const xml = await this.fetchText(url)
				const urls = this.parseSitemapXml(xml)
				if (urls.length > 0) return urls
			} catch {}
		}

		return []
	}

	private buildPrompt(
		siteUrl: string,
		mainPage: PageContent | null,
		sitemapPages: string[],
		innerPages: PageContent[],
		context?: string,
	): string {
		const formatPage = (p: PageContent) =>
			`URL: ${p.url}\nTitle: ${p.title}\nH1: ${p.h1.slice(0, 2).join(' | ')}\nH2: ${p.h2.slice(0, 4).join(' | ')}`

		const mainBlock = mainPage ? `=== Главная страница ===\n${formatPage(mainPage)}` : ''

		const innerBlock = innerPages.length
			? innerPages.map((p, i) => `=== Внутренняя страница ${i + 1} ===\n${formatPage(p)}`).join('\n\n')
			: sitemapPages.length
				? `Найдены страницы (контент недоступен):\n${sitemapPages.slice(0, 15).join('\n')}`
				: ''

		const contextBlock = context?.trim()
			? `\n=== Комментарий владельца сайта ===\n"${context.trim()}"\nУчти этот контекст при подборе ключей — он важнее автоматического анализа.\n`
			: ''

		const pagesList = [
			mainPage ? { url: mainPage.url, title: mainPage.title } : null,
			...innerPages.map(p => ({ url: p.url, title: p.title })),
		].filter(Boolean)

		const pagesJsonExample = pagesList
			.map(p => `    { "url": "${p!.url}", "title": "${p!.title}", "keywords": [...] }`)
			.join(',\n')

		return `Ты — SEO-специалист. Твоя задача — подобрать ключевые слова для привлечения покупателей и клиентов через Яндекс и Google.

Сайт: ${siteUrl}
${contextBlock}
${mainBlock}

${innerBlock}

=== ГЛАВНОЕ ПРАВИЛО ===
Подбирай ТОЛЬКО запросы с коммерческим или транзакционным намерением — те, которые вводит человек, готовый купить, заказать или найти конкретный товар/услугу.

ЗАПРЕЩЕНО включать:
- "зачем купить", "почему стоит", "что такое", "как работает", "история бренда" — никто не гуглит это перед покупкой
- абстрактные информационные запросы без привязки к конкретному действию
- запросы-вопросы ("как", "зачем", "почему"), если они не ведут напрямую к покупке

ХОРОШИЕ примеры (покупательский intent):
- "golden goose купить москва"
- "кроссовки golden goose цена"
- "golden goose superstar женские"
- "купить golden goose оригинал"
- "golden goose интернет магазин"

ПЛОХИЕ примеры (никто не покупает через эти запросы):
- "зачем покупать golden goose"
- "что такое golden goose"
- "история бренда golden goose"
- "почему golden goose стоит дорого"

=== Задача ===
Для каждой страницы подбери 4-7 ключей. Итого по сайту: 10-25 уникальных запросов.

Приоритет по типам:
1. commercial — "купить X", "X цена", "заказать X", "X со скидкой", "X интернет-магазин"
2. long_tail — конкретные запросы: модель + характеристика + действие, например "golden goose superstar 38 размер купить"
3. secondary — уточняющие: бренд + категория, материал, цвет, город
4. primary — общий брендовый/категорийный запрос, только если он реально конкурентоспособен

Запрещённый тип: НЕ включай informational запросы — они не приводят покупателей.

Поля:
- keyword: запрос строчными буквами, как реальный покупатель вводит в Яндексе
- competition: 1-10 (1 = почти нет конкуренции, 10 = огромная)
- keyword_type: primary | secondary | long_tail | commercial
- reason: одно предложение — почему этот запрос приведёт покупателя именно на эту страницу

Проверь: если сайт связан с порно/казино/наркотиками/мошенничеством — верни reject_site: true.

Верни строго JSON (без markdown, без пояснений):
{
  "site": { "topic": "тематика сайта одной фразой", "language": "ru", "warning": false, "reject_site": false },
  "pages": [
${pagesJsonExample || `    { "url": "${siteUrl}", "title": "", "keywords": [] }`}
  ]
}`
	}

	private async checkIndexingWarning(siteUrl: string): Promise<boolean> {
		try {
			const html = await this.fetchText(siteUrl)
			// Check for noindex meta tag
			if (/<meta[^>]*name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(html)) {
				return true
			}
			// Check robots.txt for Disallow: /
			const robots = await this.fetchText(`${siteUrl}/robots.txt`).catch(() => '')
			if (/Disallow:\s*\/\s*$/m.test(robots) && !/Allow:\s*\/\s*$/m.test(robots)) {
				return true
			}
			return false
		} catch {
			return false
		}
	}

	private async fetchPageContent(url: string): Promise<PageContent> {
		const html = await this.fetchText(url)
		return {
			url,
			title: this.extractTag(html, 'title') || '',
			description: this.extractMeta(html, 'description'),
			h1: this.extractTags(html, 'h1').slice(0, 3),
			h2: this.extractTags(html, 'h2').slice(0, 6),
		}
	}

	private async fetchText(url: string): Promise<string> {
		const controller = new AbortController()
		const timeout = setTimeout(() => controller.abort(), 8000)
		try {
			const res = await fetch(url, {
				signal: controller.signal,
				headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SkySEO-Bot/1.0)' },
			})
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
			return await res.text()
		} finally {
			clearTimeout(timeout)
		}
	}

	private parseSitemapXml(xml: string): string[] {
		const urls: string[] = []
		// Handle sitemap index
		const sitemapMatches = xml.matchAll(/<sitemap>[\s\S]*?<loc>(.*?)<\/loc>[\s\S]*?<\/sitemap>/gi)
		for (const m of sitemapMatches) {
			// For sitemap index, we just return the child sitemap URLs themselves as page candidates
			// In production you'd recurse, but for simplicity return them as-is
			urls.push(m[1].trim())
		}
		if (urls.length > 0) return urls

		// Regular sitemap
		const urlMatches = xml.matchAll(/<url>[\s\S]*?<loc>(.*?)<\/loc>[\s\S]*?<\/url>/gi)
		for (const m of urlMatches) {
			urls.push(m[1].trim())
		}
		return urls
	}

	private extractTag(html: string, tag: string): string {
		const m = html.match(new RegExp(`<${tag}[^>]*>(.*?)<\/${tag}>`, 'si'))
		return m ? m[1].replace(/<[^>]+>/g, '').trim() : ''
	}

	private extractTags(html: string, tag: string): string[] {
		const results: string[] = []
		const re = new RegExp(`<${tag}[^>]*>(.*?)<\/${tag}>`, 'gsi')
		for (const m of html.matchAll(re)) {
			const text = m[1].replace(/<[^>]+>/g, '').trim()
			if (text) results.push(text)
		}
		return results
	}

	private extractMeta(html: string, name: string): string {
		const m = html.match(new RegExp(`<meta[^>]*name=["']${name}["'][^>]*content=["']([^"']+)["']`, 'i'))
			|| html.match(new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*name=["']${name}["']`, 'i'))
		return m ? m[1].trim() : ''
	}

	private normalizeUrl(url: string): string {
		const trimmed = url.trim().replace(/\/$/, '')
		if (/^https?:\/\//i.test(trimmed)) return trimmed
		return 'https://' + trimmed
	}
}
