import { Injectable } from '@nestjs/common'
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
	private capacityCache: {
		value: { activePcsWeek: number; avgPerDay: number; maxPerDay: number }
		expiresAt: number
	} | null = null

	async getNetworkCapacityInfo() {
		const now = Date.now()
		if (this.capacityCache && this.capacityCache.expiresAt > now) {
			return this.capacityCache.value
		}

		const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000)
		const rows = await this.prisma.execution.findMany({
			where: { completedAt: { gte: weekAgo }, status: 'COMPLETED' },
			select: { executorId: true, completedAt: true },
		})

		// distinct активных ПК на каждый из дней → среднее в день за неделю
		const perDay = new Map<string, Set<string>>()
		const weekSet = new Set<string>()
		for (const r of rows) {
			if (!r.executorId || !r.completedAt) continue
			weekSet.add(r.executorId)
			const day = r.completedAt.toISOString().slice(0, 10)
			let set = perDay.get(day)
			if (!set) perDay.set(day, (set = new Set()))
			set.add(r.executorId)
		}
		const sumDaily = Array.from(perDay.values()).reduce((s, set) => s + set.size, 0)
		const avgPerDay = Math.round(sumDaily / 7) // усредняем по календарной неделе
		const maxPerDay = Math.max(
			1,
			Math.ceil(avgPerDay / AppConfigService.CAPACITY_SPREAD_DAYS),
		)

		const value = { activePcsWeek: weekSet.size, avgPerDay, maxPerDay }
		this.capacityCache = { value, expiresAt: now + 5 * 60 * 1000 }
		return value
	}
}
