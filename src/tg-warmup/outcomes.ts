/**
 * Итог разговора с адресатом, который проставляет человек.
 *
 * Нужен для статистики текстов: «ответили» не говорит, чем кончилось, а «уже
 * есть SEO» и «дорого» требуют разных ходов. Список короткий намеренно:
 * больше десятка вариантов никто не выбирает.
 */
export const OUTCOMES = [
	{ key: 'INTERESTED', label: 'Интересно' },
	{ key: 'MEETING', label: 'Созвон, встреча' },
	{ key: 'HAS_SEO', label: 'Уже есть SEO' },
	{ key: 'TOO_EXPENSIVE', label: 'Дорого' },
	{ key: 'REFUSED', label: 'Отказ' },
	{ key: 'NOT_TARGET', label: 'Не целевой' },
	{ key: 'WON', label: 'Клиент' },
	// Вопрос закрыт, чем бы ни кончилось: по нему больше ничего не ждём.
	{ key: 'CLOSED', label: 'Вопрос закрыт' },
] as const

export const OUTCOME_KEYS: string[] = OUTCOMES.map(o => o.key)
export const outcomeLabel = (key: string | null | undefined) => OUTCOMES.find(o => o.key === key)?.label ?? null
