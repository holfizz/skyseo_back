/**
 * Разбор телеграма и телефонов из произвольного текста, который присылают боту.
 *
 * Формат хранения совпадает с тем, что кладёт парсер сайтов (yandex-leads):
 * телефон — E.164 без пробелов (+79161112233), телеграм — @username.
 * Несколько телефонов лид хранит одной строкой через запятую.
 */

/** Телеграм всегда через @. Собака после буквы или точки — это почта, не логин. */
const TG_RE = /(?<![\w.])@([A-Za-z][A-Za-z0-9_]{3,31})\b/g

/** Ссылка на профиль: t.me/username или https://t.me/username. */
const TME_RE = /t\.me\/([A-Za-z][A-Za-z0-9_]{3,31})\b/gi

/**
 * Кандидаты в телефоны: цифры, разделённые пробелами, дефисами и скобками.
 * Ловим и «+7 (999) 123-45-67», и «89991234567», и «8 999 123 45 67».
 */
const PHONE_RE = /\+?\d[\d\s\-()]{8,20}\d/g

/**
 * Первая цифра десятизначного номера без кода страны. Ограничение нужно, чтобы
 * не принять за телефон ИНН: у московских ИНН он начинается с 7, а российские
 * коды — мобильные 9 и городские 3/4/8.
 */
const RU_AREA_FIRST = new Set(['3', '4', '8', '9'])

/** Приводит номер к +7XXXXXXXXXX. null — если это не похоже на российский номер. */
export function normalizePhone(raw: string): string | null {
	const digits = (raw || '').replace(/\D/g, '')
	if (digits.length === 11 && (digits[0] === '7' || digits[0] === '8')) {
		return `+7${digits.slice(1)}`
	}
	if (digits.length === 10 && RU_AREA_FIRST.has(digits[0])) {
		return `+7${digits}`
	}
	return null
}

/** Приводит к @username. Понимает t.me/username и голый @username. */
export function normalizeTelegram(raw: string): string | null {
	const cleaned = (raw || '')
		.trim()
		.replace(/^https?:\/\//i, '')
		.replace(/^t\.me\//i, '')
		.replace(/^@/, '')
		.trim()
	return /^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(cleaned) ? `@${cleaned}` : null
}

/**
 * Вытаскивает из текста первый телеграм и все телефоны.
 * Дубли телефонов схлопываются, порядок сохраняется.
 */
export function parseContacts(text: string): { telegram: string | null; phones: string[] } {
	const source = text || ''

	let telegram: string | null = null
	for (const m of source.matchAll(TG_RE)) {
		telegram = normalizeTelegram(m[1])
		if (telegram) break
	}
	// Логин просили присылать через @, но ссылку скопировать проще — принимаем и её.
	if (!telegram) {
		for (const m of source.matchAll(TME_RE)) {
			telegram = normalizeTelegram(m[1])
			if (telegram) break
		}
	}

	const phones: string[] = []
	for (const m of source.matchAll(PHONE_RE)) {
		const phone = normalizePhone(m[0])
		if (phone && !phones.includes(phone)) phones.push(phone)
	}

	return { telegram, phones }
}
