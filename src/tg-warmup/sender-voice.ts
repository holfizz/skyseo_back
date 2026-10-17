export type SenderGender = 'UNSPECIFIED' | 'MALE' | 'FEMALE'

export function hasSenderGender(value: unknown): value is 'MALE' | 'FEMALE' {
	return value === 'MALE' || value === 'FEMALE'
}

const pairs = [
	['смотрел', 'смотрела'], ['посмотрел', 'посмотрела'], ['заметил', 'заметила'],
	['нашел', 'нашла'], ['нашёл', 'нашла'], ['собрал', 'собрала'],
	['подготовил', 'подготовила'], ['хотел', 'хотела'], ['готов', 'готова'],
	['ждал', 'ждала'], ['рад', 'рада'], ['уверен', 'уверена'],
	['проверил', 'проверила'], ['изучил', 'изучила'], ['увидел', 'увидела'],
	['писал', 'писала'], ['написал', 'написала'], ['уточнил', 'уточнила'],
	['решил', 'решила'], ['согласен', 'согласна'], ['благодарен', 'благодарна'],
] as const
const forms = new Map<string, readonly [string, string]>()
for (const pair of pairs) for (const form of pair) if (!forms.has(form)) forms.set(form, pair)

// Approved first-person openings only. Do not change a lead's name, website,
// quoted search term, or statements such as "ваш подрядчик посмотрел сайт".
const opening = new RegExp(
	`((?:^|[.!?,;\\n]\\s*)(?:(?:я(?: уже)?|а вообще|по (?:вашему )?сайту(?: уже)?)\\s+)?|(?:показать|рассказать),?\\s+что\\s+)(${[...forms.keys()].join('|')})(?![\\p{L}\\p{N}_])`,
	'giu',
)

/** null means an account must be configured before this prepared text is used. */
export function senderVoice(text: string, gender: unknown): string | null {
	let missing = false
	const adapt = (part: string) => part.replace(opening, (whole, prefix: string, word: string) => {
		if (!hasSenderGender(gender)) { missing = true; return whole }
		const pair = forms.get(word.toLowerCase())!
		let replacement: string = pair[gender === 'FEMALE' ? 1 : 0]
		if (word === word.toUpperCase()) replacement = replacement.toUpperCase()
		else if (word[0] === word[0].toUpperCase()) replacement = replacement[0].toUpperCase() + replacement.slice(1)
		return whole.slice(0, -word.length) + replacement
	})
	const out = text.split(/(«[^»]*»|“[^”]*”|"[^"]*")/gu).map((part, i) => i % 2 ? part : adapt(part)).join('')
	return missing ? null : out
}
