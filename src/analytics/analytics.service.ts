import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

export interface TrackEventDto {
	type: 'visit' | 'download' | 'register'
	page?: string
	utmSource?: string
	utmMedium?: string
	utmCampaign?: string
	utmTerm?: string
	utmContent?: string
	referrer?: string
	platform?: string
}

@Injectable()
export class AnalyticsService {
	constructor(private prisma: PrismaService) {}

	async track(dto: TrackEventDto, ip?: string) {
		return this.prisma.pageEvent.create({
			data: {
				type: dto.type,
				page: dto.page ?? null,
				utmSource: dto.utmSource ?? null,
				utmMedium: dto.utmMedium ?? null,
				utmCampaign: dto.utmCampaign ?? null,
				utmTerm: dto.utmTerm ?? null,
				utmContent: dto.utmContent ?? null,
				referrer: dto.referrer ?? null,
				platform: dto.platform ?? null,
				ip: ip ?? null,
			},
		})
	}

	async getFunnelStats(from: Date, to: Date) {
		const [visits, downloads, registrations, byDay, bySource, byPlatform] = await Promise.all([
			this.prisma.pageEvent.count({ where: { type: 'visit', createdAt: { gte: from, lte: to } } }),
			this.prisma.pageEvent.count({ where: { type: 'download', createdAt: { gte: from, lte: to } } }),
			this.prisma.user.count({ where: { createdAt: { gte: from, lte: to } } }),

			// По дням
			this.prisma.$queryRaw<Array<{ date: string; visits: bigint; downloads: bigint; registrations: bigint }>>`
				WITH days AS (
					SELECT DISTINCT DATE(p."createdAt") AS date
					FROM page_events p
					WHERE p."createdAt" >= ${from} AND p."createdAt" <= ${to}
				),
				v AS (
					SELECT DATE("createdAt") AS date, COUNT(*) AS cnt
					FROM page_events WHERE type = 'visit' AND "createdAt" >= ${from} AND "createdAt" <= ${to}
					GROUP BY DATE("createdAt")
				),
				d AS (
					SELECT DATE("createdAt") AS date, COUNT(*) AS cnt
					FROM page_events WHERE type = 'download' AND "createdAt" >= ${from} AND "createdAt" <= ${to}
					GROUP BY DATE("createdAt")
				),
				r AS (
					SELECT DATE("createdAt") AS date, COUNT(*) AS cnt
					FROM users WHERE "createdAt" >= ${from} AND "createdAt" <= ${to}
					GROUP BY DATE("createdAt")
				)
				SELECT
					days.date::text AS date,
					COALESCE(v.cnt, 0) AS visits,
					COALESCE(d.cnt, 0) AS downloads,
					COALESCE(r.cnt, 0) AS registrations
				FROM days
				LEFT JOIN v ON v.date = days.date
				LEFT JOIN d ON d.date = days.date
				LEFT JOIN r ON r.date = days.date
				ORDER BY days.date DESC
				LIMIT 30
			`,

			// По UTM источникам
			this.prisma.pageEvent.groupBy({
				by: ['utmSource'],
				where: { type: 'visit', createdAt: { gte: from, lte: to } },
				_count: { _all: true },
				orderBy: { _count: { utmSource: 'desc' } },
				take: 10,
			}),

			// По платформам (download)
			this.prisma.pageEvent.groupBy({
				by: ['platform'],
				where: { type: 'download', createdAt: { gte: from, lte: to } },
				_count: { _all: true },
				orderBy: { _count: { platform: 'desc' } },
			}),
		])

		const visitToDownload = visits > 0 ? Math.round((downloads / visits) * 100) : 0
		const downloadToRegister = downloads > 0 ? Math.round((registrations / downloads) * 100) : 0

		return {
			funnel: { visits, downloads, registrations, visitToDownload, downloadToRegister },
			byDay: byDay.map(r => ({
				date: r.date,
				visits: Number(r.visits),
				downloads: Number(r.downloads),
				registrations: Number(r.registrations),
			})),
			bySource: bySource.map(r => ({
				source: r.utmSource ?? 'direct',
				count: r._count._all,
			})),
			byPlatform: byPlatform.map(r => ({
				platform: r.platform ?? 'unknown',
				count: r._count._all,
			})),
		}
	}
}
