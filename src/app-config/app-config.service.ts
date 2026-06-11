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
}
