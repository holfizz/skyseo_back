import { PrismaService } from '../prisma/prisma.service'

/** Длительность бесплатного продвижения, дней. */
export const TRIAL_DAYS = 7

/** Сколько дней продвижения даёт один оплаченный месяц. */
export const PAID_PERIOD_DAYS = 30

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Стартует бесплатную неделю, если выполнены ОБА условия и триал ещё не начинался:
 * у пользователя есть одобренный сайт, и на этом сайте есть хотя бы один ключ.
 * Отсчёт идёт от позднего из двух событий — поэтому вызывается и при создании
 * ключа, и при одобрении сайта: сработает тот вызов, который окажется вторым.
 *
 * Идемпотентна: updateMany с `trialStartedAt: null` в условии. Повторные вызовы
 * и гонка двух параллельных запросов не сдвинут уже проставленную дату.
 */
export async function maybeStartTrial(
	prisma: PrismaService,
	userId: string,
): Promise<void> {
	const user = await prisma.user.findUnique({
		where: { id: userId },
		select: { trialStartedAt: true, paidUntil: true },
	})
	if (!user || user.trialStartedAt) return

	const ready = await prisma.website.findFirst({
		where: { userId, isApproved: true, tasks: { some: {} } },
		select: { id: true },
	})
	if (!ready) return

	const now = new Date()
	const trialEnd = new Date(now.getTime() + TRIAL_DAYS * DAY_MS)
	// Если человек уже оплатил вперёд — не укорачиваем ему срок бесплатной неделей.
	const paidUntil =
		user.paidUntil && user.paidUntil > trialEnd ? user.paidUntil : trialEnd

	await prisma.user.updateMany({
		where: { id: userId, trialStartedAt: null },
		data: { trialStartedAt: now, paidUntil },
	})
}

/**
 * Продлить продвижение на оплаченный период. Если срок ещё не истёк — прибавляем
 * к нему, чтобы оплата «в середине месяца» не сжигала остаток.
 */
export function extendPaidUntil(
	current: Date | null | undefined,
	days: number = PAID_PERIOD_DAYS,
	now: Date = new Date(),
): Date {
	const base = current && current > now ? current : now
	return new Date(base.getTime() + days * DAY_MS)
}

/** Оплачено ли продвижение прямо сейчас (триал тоже считается оплатой). */
export function isPromotionPaid(
	paidUntil: Date | null | undefined,
	now: Date = new Date(),
): boolean {
	return !!paidUntil && paidUntil.getTime() > now.getTime()
}

/**
 * Сколько дней продвижения осталось. 0 — если не оплачено.
 * Округляем вверх: «остался 1 день» честнее, чем «осталось 0», пока срок не вышел.
 */
export function daysLeft(
	paidUntil: Date | null | undefined,
	now: Date = new Date(),
): number {
	if (!paidUntil) return 0
	const ms = paidUntil.getTime() - now.getTime()
	return ms <= 0 ? 0 : Math.ceil(ms / DAY_MS)
}

/** Идёт ли ещё бесплатная неделя (для баннеров и дожима, не для гейта). */
export function isTrialActive(
	trialStartedAt: Date | null | undefined,
	now: Date = new Date(),
): boolean {
	if (!trialStartedAt) return false
	return now.getTime() < trialStartedAt.getTime() + TRIAL_DAYS * DAY_MS
}

/** Момент окончания бесплатной недели. null — если триал не начинался. */
export function trialEndsAt(trialStartedAt: Date | null | undefined): Date | null {
	if (!trialStartedAt) return null
	return new Date(trialStartedAt.getTime() + TRIAL_DAYS * DAY_MS)
}
