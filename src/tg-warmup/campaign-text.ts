/**
 * Подстановка в шаблон сообщения.
 *
 * Плейсхолдеры на русском намеренно: текст пишет владелец, а не разработчик, и
 * {имя} читается без справки, в отличие от {{first_name}}.
 *
 * Неизвестный плейсхолдер НЕ оставляем в тексте: «Здравствуйте, {имя}» уходит
 * живому человеку и сразу выдаёт рассылку. Пустое значение вырезается вместе с
 * лишними пробелами и запятой перед ним.
 *
 * Но вырезание — это подстраховка, а не рабочий режим. Отправщик СНАЧАЛА
 * спрашивает missingPlaceholders и, если данных не хватает, не шлёт вовсе:
 * «Здравствуйте, ждал будние, чтобы вам написать» без имени выглядит хуже,
 * чем ненаписанное сообщение, и такой адресат сгорает навсегда.
 */

export type Placeholders = {
	firstName?: string | null
	middleName?: string | null
	lastName?: string | null
	company?: string | null
	domain?: string | null
}

/** Имя сайта без зоны: адрес с точкой Telegram превращает в ссылку. */
function siteName(domain?: string | null): string {
	const clean = String(domain ?? '').trim().toLowerCase()
		.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '')
	const parts = clean.split('.')
	if (parts.length < 2) return clean
	parts.pop()
	if (parts.length > 1 && ['com', 'co', 'net', 'org'].includes(parts[parts.length - 1])) parts.pop()
	return parts.join('.')
}

export const PLACEHOLDERS = ['имя', 'отчество', 'фамилия', 'фио', 'сайт', 'компания'] as const

function values(p: Placeholders): Record<string, string> {
	return {
		'имя': (p.firstName ?? '').trim(),
		'отчество': (p.middleName ?? '').trim(),
		'фамилия': (p.lastName ?? '').trim(),
		'фио': [p.firstName, p.middleName].map(v => (v ?? '').trim()).filter(Boolean).join(' '),
		'сайт': siteName(p.domain),
		'компания': (p.company ?? '').trim(),
	}
}

export function fillTemplate(template: string, p: Placeholders): string {
	const vals = values(p)

	let out = template.replace(/\{([^{}]+)\}/g, (_, key) => vals[String(key).trim().toLowerCase()] ?? '')

	// Уборка после пустых подстановок: «, здравствуйте» и двойные пробелы.
	out = out
		.replace(/[ \t]{2,}/g, ' ')
		.replace(/^[ \t]*[,;]\s*/gm, '')
		.replace(/\s+([,;])/g, '$1')
		.replace(/,\s*,/g, ',')
		.split('\n')
		// Строка, начинавшаяся с имени, после выреза начинается со строчной.
		// Оставить так — заметнее, чем отсутствие имени.
		.map(l => l.trimEnd().replace(/^(\p{Ll})/u, c => c.toUpperCase()))
		.join('\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim()
	return out
}

/** Какие плейсхолдеры в шаблоне не будут заполнены у этого адресата. */
export function missingPlaceholders(template: string, p: Placeholders): string[] {
	const used = [...template.matchAll(/\{([^{}]+)\}/g)].map(m => m[1].trim().toLowerCase())
	const filled = values(p)
	return [...new Set(used.filter(k => !filled[k]))]
}
