import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'

const METRIKA_API = 'https://api-metrika.yandex.net/stat/v1/data'
const OAUTH_URL = 'https://oauth.yandex.ru'
const TOKEN_FILE = join(process.cwd(), 'metrika_token.json')

@Injectable()
export class MetrikaService implements OnModuleInit {
	private readonly logger = new Logger(MetrikaService.name)
	private runtimeToken: string | null = null

	constructor(private config: ConfigService) {}

	async onModuleInit() {
		try {
			const raw = await readFile(TOKEN_FILE, 'utf8')
			this.runtimeToken = JSON.parse(raw).token ?? null
			if (this.runtimeToken) this.logger.log('Metrika token loaded from file')
		} catch {
			// file doesn't exist yet — fine
		}
	}

	private get token(): string | null {
		return this.runtimeToken || this.config.get('METRIKA_TOKEN') || null
	}
	private get counterId(): string { return this.config.get('METRIKA_COUNTER_ID') || '' }
	private get clientId(): string { return this.config.get('METRIKA_CLIENT_ID') || '' }
	private get clientSecret(): string { return this.config.get('METRIKA_CLIENT_SECRET') || '' }

	getAuthUrl(): string {
		return `${OAUTH_URL}/authorize?response_type=code&client_id=${this.clientId}`
	}

	async exchangeCode(code: string): Promise<string> {
		const params = new URLSearchParams({
			grant_type: 'authorization_code',
			code,
			client_id: this.clientId,
			client_secret: this.clientSecret,
		})
		const res = await fetch(`${OAUTH_URL}/token`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: params.toString(),
		})
		if (!res.ok) throw new Error(`Yandex OAuth error: ${await res.text()}`)
		const data = await res.json()
		this.runtimeToken = data.access_token
		await writeFile(TOKEN_FILE, JSON.stringify({ token: data.access_token }), 'utf8')
		return data.access_token as string
	}

	isConfigured(): boolean {
		return !!this.token && !!this.counterId
	}

	async getStats(days = 30) {
		if (!this.isConfigured()) return null

		const date2 = new Date()
		const date1 = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
		const d1 = date1.toISOString().slice(0, 10)
		const d2 = date2.toISOString().slice(0, 10)

		const today = date2.toISOString().slice(0, 10)

		const [trend, sources, devices, geography, pages, newVsReturn, todayData, utmData, searchData] = await Promise.allSettled([
			// Динамика по дням
			this.fetch({
				metrics: 'ym:s:visits,ym:s:users,ym:s:bounceRate,ym:s:avgVisitDurationSeconds,ym:s:pageviews',
				dimensions: 'ym:s:date',
				date1: d1, date2: d2, sort: 'ym:s:date', limit: '60',
			}),
			// Источники трафика
			this.fetch({
				metrics: 'ym:s:visits,ym:s:users,ym:s:bounceRate',
				dimensions: 'ym:s:trafficSourceName',
				date1: d1, date2: d2, sort: '-ym:s:visits', limit: '8',
			}),
			// Устройства
			this.fetch({
				metrics: 'ym:s:visits,ym:s:users',
				dimensions: 'ym:s:deviceCategory',
				date1: d1, date2: d2, sort: '-ym:s:visits',
			}),
			// Города
			this.fetch({
				metrics: 'ym:s:visits,ym:s:users',
				dimensions: 'ym:s:regionCityName',
				date1: d1, date2: d2, sort: '-ym:s:visits', limit: '10',
			}),
			// Топ страниц
			this.fetch({
				metrics: 'ym:s:visits,ym:s:pageviews,ym:s:avgVisitDurationSeconds,ym:s:bounceRate',
				dimensions: 'ym:s:URLPath',
				date1: d1, date2: d2, sort: '-ym:s:visits', limit: '10',
			}),
			// Новые vs вернувшиеся
			this.fetch({
				metrics: 'ym:s:visits,ym:s:users',
				dimensions: 'ym:s:newUsersBehavior',
				date1: d1, date2: d2, sort: '-ym:s:visits',
			}),
			// Сегодня
			this.fetch({
				metrics: 'ym:s:visits,ym:s:users,ym:s:pageviews',
				date1: today, date2: today,
			}),
			// UTM визиты — по UTM-источникам
			this.fetch({
				metrics: 'ym:s:visits',
				dimensions: 'ym:s:UTMSource',
				date1: d1, date2: d2, sort: '-ym:s:visits', limit: '20',
			}),
			// Визиты с поиска
			this.fetch({
				metrics: 'ym:s:visits,ym:s:users',
				dimensions: 'ym:s:searchEngineName',
				date1: d1, date2: d2, sort: '-ym:s:visits', limit: '10',
			}),
		])

		const get = (r: PromiseSettledResult<any>) => r.status === 'fulfilled' ? r.value : null

		const trendData = get(trend)
		const totals = trendData?.totals ?? []

		const todayTotals = get(todayData)?.totals ?? []
		const utmRows = get(utmData)?.data ?? []
		const utmTotal = utmRows
			.filter((r: any) => r.dimensions?.[0]?.name)
			.reduce((s: number, r: any) => s + Math.round(r.metrics?.[0] ?? 0), 0)
		const searchRows = get(searchData)?.data ?? []
		const searchTotal = searchRows
			.filter((r: any) => r.dimensions?.[0]?.name)
			.reduce((s: number, r: any) => s + Math.round(r.metrics?.[0] ?? 0), 0)

		return {
			summary: {
				visits: Math.round(totals[0] ?? 0),
				users: Math.round(totals[1] ?? 0),
				bounceRate: Math.round((totals[2] ?? 0) * 10) / 10,
				avgDuration: Math.round(totals[3] ?? 0),
				pageviews: Math.round(totals[4] ?? 0),
				todayVisits: Math.round(todayTotals[0] ?? 0),
				todayUsers: Math.round(todayTotals[1] ?? 0),
				utmVisits: utmTotal,
				searchVisits: searchTotal,
			},
			utmSources: utmRows
				.filter((r: any) => r.dimensions?.[0]?.name)
				.map((r: any) => ({
					source: r.dimensions[0].name,
					visits: Math.round(r.metrics?.[0] ?? 0),
				})),
			searchEngines: searchRows
				.filter((r: any) => r.dimensions?.[0]?.name)
				.map((r: any) => ({
					name: r.dimensions[0].name,
					visits: Math.round(r.metrics?.[0] ?? 0),
					users: Math.round(r.metrics?.[1] ?? 0),
				})),
			byDay: (trendData?.data ?? []).map((r: any) => ({
				date: r.dimensions?.[0]?.name ?? '',
				visits: Math.round(r.metrics?.[0] ?? 0),
				users: Math.round(r.metrics?.[1] ?? 0),
				bounceRate: Math.round((r.metrics?.[2] ?? 0) * 10) / 10,
				avgDuration: Math.round(r.metrics?.[3] ?? 0),
				pageviews: Math.round(r.metrics?.[4] ?? 0),
			})),
			sources: (get(sources)?.data ?? []).map((r: any) => ({
				name: r.dimensions?.[0]?.name ?? '—',
				visits: Math.round(r.metrics?.[0] ?? 0),
				users: Math.round(r.metrics?.[1] ?? 0),
				bounceRate: Math.round((r.metrics?.[2] ?? 0) * 10) / 10,
			})),
			devices: (get(devices)?.data ?? []).map((r: any) => ({
				name: r.dimensions?.[0]?.name ?? '—',
				visits: Math.round(r.metrics?.[0] ?? 0),
				users: Math.round(r.metrics?.[1] ?? 0),
			})),
			geography: (get(geography)?.data ?? []).map((r: any) => ({
				city: r.dimensions?.[0]?.name ?? '—',
				visits: Math.round(r.metrics?.[0] ?? 0),
				users: Math.round(r.metrics?.[1] ?? 0),
			})),
			topPages: (get(pages)?.data ?? []).map((r: any) => ({
				path: r.dimensions?.[0]?.name ?? '—',
				visits: Math.round(r.metrics?.[0] ?? 0),
				pageviews: Math.round(r.metrics?.[1] ?? 0),
				avgDuration: Math.round(r.metrics?.[2] ?? 0),
				bounceRate: Math.round((r.metrics?.[3] ?? 0) * 10) / 10,
			})),
			newVsReturn: (get(newVsReturn)?.data ?? []).map((r: any) => ({
				type: r.dimensions?.[0]?.name ?? '—',
				visits: Math.round(r.metrics?.[0] ?? 0),
				users: Math.round(r.metrics?.[1] ?? 0),
			})),
		}
	}

	private async fetch(params: Record<string, string>) {
		const url = new URL(METRIKA_API)
		url.searchParams.set('id', this.counterId)
		Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
		const res = await fetch(url.toString(), {
			headers: { Authorization: `OAuth ${this.token}` },
		})
		if (!res.ok) {
			this.logger.warn(`Metrika ${res.status}: ${await res.text()}`)
			return null
		}
		return res.json()
	}
}
