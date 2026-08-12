// Текст холодного сообщения. Структура утверждена заказчиком — менять нельзя.
// Отдельно оговорено: НЕ обещаем сроки и НЕ считаем трафик в переходах.

export type MessageKeyword = { keyword: string; position: number }
export type MessageCompetitor = { domain: string; position: number }

export type MessageInput = {
	domain: string
	firstName?: string | null
	middleName?: string | null
	// ключи лида, отсортированные по позиции: лучшие первыми
	keywords: MessageKeyword[]
	// домены с 9 и 10 мест по ключам лида
	competitors: MessageCompetitor[]
	reportUrl?: string | null
}

const MAX_KEYWORDS_SHOWN = 3

// Обращение: «Имя Отчество» если отчество есть, иначе «Имя», иначе без обращения.
// ФИО заполняется руками в админке, автоматом его никто не подставляет.
function greeting(firstName?: string | null, middleName?: string | null): string {
	const first = firstName?.trim()
	const middle = middleName?.trim()
	if (first && middle) return `Здравствуйте, ${first} ${middle}!`
	if (first) return `Здравствуйте, ${first}!`
	return 'Здравствуйте!'
}

// «и ещё 1 запрос, по которому…» / «и ещё 2 запроса, по которым…»
function restLine(n: number): string {
	const mod100 = n % 100
	const mod10 = n % 10
	const teen = mod100 >= 11 && mod100 <= 14
	if (!teen && mod10 === 1) return `и ещё ${n} запрос, по которому можно подняться.`
	const word = !teen && mod10 >= 2 && mod10 <= 4 ? 'запроса' : 'запросов'
	return `и ещё ${n} ${word}, по которым можно подняться.`
}

export function buildOutreachMessage(input: MessageInput): string {
	const blocks: string[] = [greeting(input.firstName, input.middleName)]

	const shown = input.keywords.slice(0, MAX_KEYWORDS_SHOWN)
	if (shown.length > 0) {
		blocks.push(`Смотрел выдачу Яндекса по вашему сайту ${input.domain}:`)
		blocks.push(shown.map(k => `«${k.keyword}» — ${k.position} место`).join('\n'))
		// Если ключей ≤ 3 — строку «и ещё N» не выводим вовсе.
		const rest = input.keywords.length - shown.length
		if (rest > 0) blocks.push(restLine(rest))
	} else {
		// Ключей нет (лид заведён руками, без прогона парсера) — двоеточие в никуда не ставим.
		blocks.push(`Смотрел выдачу Яндекса по вашему сайту ${input.domain}.`)
	}

	// Позиции берём из данных, а не хардкодим «9 и 10»: если по ключам лида нашлась
	// только одна из этих строк, текст не должен врать.
	const rivals = input.competitors.slice(0, 2)
	if (rivals.length >= 2) {
		blocks.push(
			`На ${rivals[0].position} и ${rivals[1].position} месте сейчас ${rivals[0].domain} и ${rivals[1].domain} —\nвас можно поднять на их место.`,
		)
	} else if (rivals.length === 1) {
		blocks.push(`На ${rivals[0].position} месте сейчас ${rivals[0].domain} —\nвас можно поднять на его место.`)
	}

	if (input.reportUrl) {
		blocks.push(`Собрал разбор с конкурентами и планом: ${input.reportUrl}. Бесплатно.`)
	}

	return blocks.join('\n\n')
}
