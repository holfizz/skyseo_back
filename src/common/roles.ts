/**
 * Единая точка проверки ролей. Все гварды и сервисы ходят сюда, а не сравнивают строки руками.
 *
 * Модель ролей:
 *   User.role  — «главная» роль, всегда = roles[0]. Читают Electron-приложение и старый код.
 *   User.roles — массив, источник правды для сайта. Несколько ролей = несколько разделов в CRM.
 *
 * hasRole() смотрит на массив, а если он пуст (старая запись, миграция ещё не прошла) —
 * откатывается на одиночное поле. Поэтому функция безопасна в любой момент раскатки.
 *
 * ADMIN — сквозной: админ проходит любую проверку роли, отдельные роли ему выдавать не нужно.
 */

export type RoleName = 'USER' | 'ADMIN' | 'SMM' | 'MANAGER'

type RoleCarrier = {
	role?: string | null
	roles?: string[] | null
} | null | undefined

/** Все роли пользователя: массив, либо [role] для записей до миграции. */
export function rolesOf(user: RoleCarrier): string[] {
	if (!user) return []
	const list = Array.isArray(user.roles) ? user.roles.filter(Boolean) : []
	if (list.length > 0) return list
	return user.role ? [user.role] : []
}

/** Есть ли у пользователя роль. ADMIN проходит всегда. */
export function hasRole(user: RoleCarrier, ...required: RoleName[]): boolean {
	const own = rolesOf(user)
	if (own.includes('ADMIN')) return true
	return required.some(r => own.includes(r))
}

/** Строгая проверка без привилегии админа — для мест, где ADMIN не должен подменять сотрудника. */
export function hasRoleStrict(user: RoleCarrier, ...required: RoleName[]): boolean {
	const own = rolesOf(user)
	return required.some(r => own.includes(r))
}

/**
 * Нормализует набор ролей перед записью в БД:
 * убирает дубли и пустые значения, ставит «главную» роль первой.
 * Пустой набор → ['USER'], чтобы у пользователя всегда была хотя бы одна роль.
 */
export function normalizeRoles(input: string[] | null | undefined, primary?: string | null): RoleName[] {
	const VALID: RoleName[] = ['USER', 'ADMIN', 'SMM', 'MANAGER']
	const clean = (input ?? []).filter((r): r is RoleName => VALID.includes(r as RoleName))
	const unique = Array.from(new Set(clean))
	if (unique.length === 0) return ['USER']
	// «Главная» роль — та, что просили, иначе самая привилегированная из набора.
	const order: RoleName[] = ['ADMIN', 'MANAGER', 'SMM', 'USER']
	const head =
		primary && unique.includes(primary as RoleName)
			? (primary as RoleName)
			: order.find(r => unique.includes(r))!
	return [head, ...unique.filter(r => r !== head)]
}
