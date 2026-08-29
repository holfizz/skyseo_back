// Текст холодного сообщения. Структура утверждена заказчиком — менять нельзя.
// Отдельно оговорено: НЕ обещаем сроки и НЕ считаем трафик в переходах.
//
// В самом тексте не должно быть длинных тире и буквы «ё»: заказчик считает,
// что они выдают машинный набор. Отчёт лид получает файлом от менеджера,
// поэтому ссылки в сообщении нет.

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
	// суммарная частотность показанных запросов по Вордстату
	volume?: number | null
}

const MAX_KEYWORDS_SHOWN = 3

// Ниже этого порога цифра спроса скорее ослабляет письмо, чем усиливает.
const MIN_VOLUME_SHOWN = 100

// Обращение: «Имя Отчество» если отчество есть, иначе «Имя», иначе без обращения.
// ФИО заполняется руками в админке, автоматом его никто не подставляет.
function greeting(firstName?: string | null, middleName?: string | null): string {
	const first = firstName?.trim()
	const middle = middleName?.trim()
	if (first && middle) return `Здравствуйте, ${first} ${middle}!`
	if (first) return `Здравствуйте, ${first}!`
	return 'Здравствуйте!'
}

/**
 * Спрос считаем ровно по тем запросам, что попали в текст: если сложить все
 * ключи лида, цифра разойдётся со списком у него перед глазами.
 */
export function sumShownVolume(keywords: MessageKeyword[], volumes: Map<string, number>): number {
	return keywords
		.slice(0, MAX_KEYWORDS_SHOWN)
		.reduce((sum, k) => sum + (volumes.get(k.keyword) ?? 0), 0)
}

function plural(n: number, one: string, few: string, many: string): string {
	const mod100 = n % 100
	const mod10 = n % 10
	if (mod100 >= 11 && mod100 <= 14) return many
	if (mod10 === 1) return one
	if (mod10 >= 2 && mod10 <= 4) return few
	return many
}

export function buildOutreachMessage(input: MessageInput): string {
	const blocks: string[] = [greeting(input.firstName, input.middleName)]

	const shown = input.keywords.slice(0, MAX_KEYWORDS_SHOWN)
	if (shown.length > 0) {
		blocks.push(
			`Ваш сайт ${input.domain} есть в выдаче Яндекса:\n` +
				shown.map(k => `«${k.keyword}» на ${k.position} месте`).join('\n'),
		)
	} else {
		// Ключей нет (лид заведён руками, без прогона парсера) — двоеточие в никуда не ставим.
		blocks.push(`Мы посмотрели, где ваш сайт ${input.domain} стоит в выдаче Яндекса.`)
	}

	// Позиции берём из данных, а не хардкодим «9 и 10»: если по ключам лида нашлась
	// только одна из этих строк, текст не должен врать.
	const rivals = input.competitors.slice(0, 2)
	if (rivals.length >= 2) {
		blocks.push(
			`Выше вас, на ${rivals[0].position} и ${rivals[1].position} местах, стоят ${rivals[0].domain} и ${rivals[1].domain}.`,
		)
	} else if (rivals.length === 1) {
		blocks.push(`Выше вас, на ${rivals[0].position} месте, стоит ${rivals[0].domain}.`)
	}

	const volume = input.volume ?? 0
	const demand =
		volume >= MIN_VOLUME_SHOWN
			? ` По этим запросам в Яндексе ищут ${volume.toLocaleString('ru-RU')} ${plural(volume, 'раз', 'раза', 'раз')} в месяц, и сейчас эти люди попадают на сайты выше вашего.`
			: ''
	blocks.push(
		'Мы занимаемся продвижением сайтов в поиске. Это не массовая рассылка: ' +
			'запросы мы собрали именно по вашему сайту, сняли позиции и посмотрели частотность в Вордстате.' +
			demand,
	)

	blocks.push(
		'Если разрешите, пришлем отчет: где вы сейчас, кто стоит выше и сколько людей ищет ваши услуги. ' +
			'Бесплатно, оплачивать ничего не нужно.',
	)

	blocks.push(
		'Если будет интересно, начнем поднимать сайт в топ-10. Если нет, у вас просто останется ' +
			'отчет по вашему сайту.',
	)

	return blocks.join('\n\n')
}

/**
 * Открывающее сообщение — первое касание в Telegram.
 *
 * Текст утверждён заказчиком дословно, менять формулировки нельзя. Смысл: не
 * продавать с порога, а спросить разрешения на разговор. Позиции и конкуренты
 * идут вторым сообщением, после согласия.
 *
 * Обращение здесь своё: «Имя Отчество, здравствуйте!» — имя первым, иначе
 * читается как шаблон. Поэтому greeting() не переиспользуется.
 *
 * Последняя строка «Я по работе» обязательна: без неё сообщение от незнакомого
 * аккаунта читается как личное и его закрывают, не дочитав.
 */
export function buildOpeningMessage(input: MessageInput): string {
	const first = input.firstName?.trim()
	const middle = input.middleName?.trim()
	const name = [first, middle].filter(Boolean).join(' ')
	const hello = name ? `${name}, здравствуйте!` : 'Здравствуйте!'

	return `${hello}\n\nМогу с вами пообщаться по поводу вашего сайта - ${input.domain}\nЯ по работе`
}
