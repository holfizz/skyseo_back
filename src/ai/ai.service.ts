import { BadRequestException, Injectable } from '@nestjs/common'
import OpenAI from 'openai'

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

	async analyzeSite(url: string): Promise<AnalyzeResult> {
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

		// Fetch main page
		const mainPage = await this.fetchPageContent(siteUrl).catch(() => null)

		// Check indexing
		const warning = await this.checkIndexingWarning(siteUrl)

		// Get sitemap pages
		const sitemapPages = await this.getSitemapUrls(siteUrl).catch(() => [])

		// Build prompt
		const prompt = this.buildPrompt(siteUrl, mainPage, sitemapPages)

		// Call OpenAI
		try {
			const response = await this.openai.chat.completions.create({
				model: 'gpt-4o-mini',
				messages: [{ role: 'user', content: prompt }],
				response_format: { type: 'json_object' },
				max_tokens: 2500,
				temperature: 0.3,
			})

			const raw = response.choices[0]?.message?.content
			if (!raw) throw new Error('Empty response from OpenAI')

			const parsed = JSON.parse(raw) as AnalyzeResult
			parsed.site.warning = warning
			parsed.sitemapPages = sitemapPages.slice(0, 50)
			return parsed
		} catch (err) {
			throw new BadRequestException('Ошибка анализа сайта через AI: ' + (err as Error).message)
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

	private buildPrompt(siteUrl: string, mainPage: PageContent | null, sitemapPages: string[]): string {
		const pagesInfo = sitemapPages.slice(0, 20).join('\n')

		return `Ты — SEO AI assistant внутри приложения SkySEO.

Проанализируй сайт и предложи релевантные SEO-ключевые слова.

Сайт: ${siteUrl}

${mainPage ? `Главная страница:
- Title: ${mainPage.title}
- Description: ${mainPage.description}
- H1: ${mainPage.h1.slice(0, 3).join(' | ')}
- H2: ${mainPage.h2.slice(0, 5).join(' | ')}` : ''}

${pagesInfo ? `Страницы сайта (из sitemap):
${pagesInfo}` : ''}

Задача:
1. Определи тематику сайта и язык контента
2. Предложи 8-15 SEO-ключевиков для продвижения
3. Сосредоточься на: long-tail запросах, low-competition, реальных запросах людей
4. Проверь: если сайт связан с порно/казино/наркотиками/мошенничеством → reject_site: true

Для каждого ключа:
- keyword: сам запрос (как люди реально ищут)
- competition: 1-10 (1=очень низкая, 10=очень высокая конкуренция)
- keyword_type: primary/secondary/long_tail/informational/commercial
- reason: 1 предложение почему этот ключ хорош

Верни строго JSON:
{
  "site": {
    "topic": "тематика сайта",
    "language": "ru",
    "warning": false,
    "reject_site": false
  },
  "pages": [
    {
      "url": "${siteUrl}",
      "title": "${mainPage?.title || ''}",
      "keywords": [
        {
          "keyword": "пример запроса",
          "competition": 3,
          "keyword_type": "long_tail",
          "reason": "Низкая конкуренция, реальный запрос"
        }
      ]
    }
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
