import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

const DAILY_POINTS = 50
const DAY_MS = 24 * 60 * 60 * 1000

// Полночь UTC переданного момента — дневная гранулярность для @@unique([userId, date]).
function utcDay(d = new Date()): Date {
	return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

@Injectable()
export class RewardsService {
	constructor(private prisma: PrismaService) {}

	// Начисляем награду за онлайн один раз в сутки. Вызывается из heartbeat — то есть
	// пока приложение в сети, баллы капают даже без задач. Идемпотентно: повторный
	// вызов в тот же день ничего не начисляет (защита — @@unique([userId, date])).
	// Ничего не возвращает: экран стрика читается отдельным getStreak, чтобы не нагружать heartbeat.
	async claimDaily(userId: string, isSuspicious = false): Promise<void> {
		// Подозрительные аккаунты награду за онлайн не получают (защита от фарма на VPS).
		if (isSuspicious) return

		const today = utcDay()
		const existing = await this.prisma.dailyReward.findUnique({
			where: { userId_date: { userId, date: today } },
		})
		if (existing) return

		const yesterday = new Date(today.getTime() - DAY_MS)
		const prev = await this.prisma.dailyReward.findUnique({
			where: { userId_date: { userId, date: yesterday } },
		})
		const streak = prev ? prev.streak + 1 : 1

		try {
			await this.prisma.$transaction(async tx => {
				await tx.dailyReward.create({
					data: { userId, date: today, points: DAILY_POINTS, streak },
				})
				await tx.user.update({
					where: { id: userId },
					data: { balance: { increment: DAILY_POINTS } },
				})
				await tx.balanceHistory.create({
					data: {
						userId,
						amount: DAILY_POINTS,
						type: 'DAILY_REWARD',
						description: `Ежедневная награда · день ${streak}`,
					},
				})
			})
		} catch (e: any) {
			// P2002 — параллельный heartbeat уже начислил сегодня. Уникальный индекс
			// откатил вторую транзакцию целиком, двойного начисления нет. Молча игнорируем.
			if (e?.code !== 'P2002') throw e
		}
	}

	// Данные для экрана стрика: текущая серия, всего начислено, календарь последних дней.
	async getStreak(userId: string) {
		const today = utcDay()
		const since = new Date(today.getTime() - 34 * DAY_MS)

		const [rows, agg] = await Promise.all([
			this.prisma.dailyReward.findMany({
				where: { userId, date: { gte: since } },
				orderBy: { date: 'asc' },
				select: { date: true, points: true },
			}),
			this.prisma.dailyReward.aggregate({
				where: { userId },
				_sum: { points: true },
				_count: true,
			}),
		]) as [Array<{ date: Date; points: number }>, { _sum: { points: number | null }; _count: number }]

		const last = await this.prisma.dailyReward.findFirst({
			where: { userId },
			orderBy: { date: 'desc' },
			select: { date: true, streak: true },
		})

		const yesterday = new Date(today.getTime() - DAY_MS)
		const lastMs = last ? utcDay(last.date).getTime() : 0
		const currentStreak =
			last && (lastMs === today.getTime() || lastMs === yesterday.getTime()) ? last.streak : 0
		const claimedToday = !!last && lastMs === today.getTime()

		return {
			currentStreak,
			claimedToday,
			pointsPerDay: DAILY_POINTS,
			totalEarned: agg._sum.points ?? 0,
			daysActive: agg._count,
			// Календарь: список дат (ISO), за которые начислено, за последние ~35 дней.
			days: rows.map(r => ({ date: r.date.toISOString(), points: r.points })),
		}
	}
}
