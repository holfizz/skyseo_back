import { PrismaService } from '../prisma/prisma.service'

/**
 * Ищет промокод в БД (через PromoCode таблицу).
 * Управление — через /admin/promo-codes-* endpoints в админке.
 */
export async function lookupPromoCode(
	prisma: PrismaService,
	input: string | null | undefined,
): Promise<{ code: string; bonusPoints: number; description: string | null } | null> {
	if (!input) return null
	const normalized = input.trim().toUpperCase()
	if (!normalized) return null
	const entry = await prisma.promoCode.findUnique({
		where: { code: normalized },
	})
	if (!entry || !entry.isActive) return null
	return {
		code: entry.code,
		bonusPoints: entry.bonusPoints,
		description: entry.description,
	}
}
