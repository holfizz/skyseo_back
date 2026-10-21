/** Operator-facing attribution: Telegram profile name first, internal label only as fallback. */
export function senderLabel(account?: {
	firstName?: string | null; lastName?: string | null; label?: string | null; username?: string | null; id?: string
} | null): string {
	if (!account) return 'не указан'
	const name = [account.firstName?.trim(), account.lastName?.trim()].filter(Boolean).join(' ')
	const username = account.username?.trim().replace(/^@/, '')
	const label = name || account.label?.trim() || (username ? `@${username}` : account.id) || 'не указан'
	return username && label !== `@${username}` ? `${label} (@${username})` : label
}
