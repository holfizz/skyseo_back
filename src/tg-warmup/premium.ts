import type { Prisma } from '@prisma/client'

type PremiumAccount = { probe?: unknown; premiumCheckedAt?: Date | null; premiumUntil?: Date | null }

/** A successful check remains valid; a known subscription deadline takes precedence. */
export function hasActivePremium(account: PremiumAccount, now = new Date()): boolean {
	return (account.probe as { premium?: boolean } | null)?.premium === true && !!account.premiumCheckedAt
		&& (!account.premiumUntil || account.premiumUntil.getTime() > now.getTime())
}

/** Same policy in the atomic sender claim; no rolling 24-hour freshness requirement. */
export function activePremiumWhere(now: Date): Prisma.TgAccountWhereInput {
	return { probe: { path: ['premium'], equals: true }, premiumCheckedAt: { not: null },
		OR: [{ premiumUntil: null }, { premiumUntil: { gt: now } }] }
}

/** Operator enters the last paid calendar day, inclusive, in Moscow time. */
export function parsePremiumUntil(value: unknown): Date | null {
	if (value === null) return null
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Укажите дату Premium в формате ГГГГ-ММ-ДД')
	const date = new Date(`${value}T00:00:00.000Z`)
	if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error('Укажите существующую дату Premium')
	return new Date(date.getTime() + 86400000 - 3 * 3600000)
}
