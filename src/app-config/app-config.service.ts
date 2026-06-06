import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

export const KEY_GOOGLE_SOCS = 'google_socs'
export const KEY_GOOGLE_CONSENT = 'google_consent'

// Best-effort дефолты «accept all». Если в БД ничего нет — отдаём их.
// SOCS со временем устаревает — обновляется в админке (/holfizz/settings) без пересборки app.
export const DEFAULT_GOOGLE_SOCS = 'CAESHAgBEhJnd3NfMjAyMzA4MDktMF9SQzEaAmVuIAEaBgiAo_CmBg'
export const DEFAULT_GOOGLE_CONSENT = 'YES+'

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

	// Что читает desktop-app перед заходом в Google
	async getGoogleConfig() {
		const [socs, consent] = await Promise.all([
			this.get(KEY_GOOGLE_SOCS, DEFAULT_GOOGLE_SOCS),
			this.get(KEY_GOOGLE_CONSENT, DEFAULT_GOOGLE_CONSENT),
		])
		return { socs, consent }
	}
}
