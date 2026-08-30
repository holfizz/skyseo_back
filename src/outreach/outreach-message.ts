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

/**
 * Спрос считаем ровно по тем запросам, что попали в текст: если сложить все
 * ключи лида, цифра разойдётся со списком у него перед глазами.
 */
export function sumShownVolume(keywords: MessageKeyword[], volumes: Map<string, number>): number {
	return keywords
		.slice(0, MAX_KEYWORDS_SHOWN)
		.reduce((sum, k) => sum + (volumes.get(k.keyword) ?? 0), 0)
}

// Ниже этого порога цифра спроса скорее ослабляет письмо, чем усиливает.
const MIN_VOLUME_SHOWN = 100

/**
 * Точка в конце абзаца не ставится, внутри абзаца остаётся.
 *
 * Правило заказчика: «ваши услуги. Бесплатно» — точка между предложениями нужна,
 * а на последнем слове абзаца её быть не должно, иначе текст выглядит как
 * официальное письмо, а не как сообщение живого человека в мессенджере.
 *
 * Снимаем только точку: вопросительный знак у «Прислать?» обязан остаться.
 */
function trimDot(text: string): string {
	return text.replace(/\.$/, '')
}

function plural(n: number, one: string, few: string, many: string): string {
	const mod100 = n % 100
	const mod10 = n % 10
	if (mod100 >= 11 && mod100 <= 14) return many
	if (mod10 === 1) return one
	if (mod10 >= 2 && mod10 <= 4) return few
	return many
}

/**
 * Второе сообщение — уходит после того, как человек ответил на открывающее.
 *
 * Текст утверждён заказчиком. Каждый блок собирается из данных и ПРОПУСКАЕТСЯ,
 * если данных нет: лид, заведённый руками без прогона парсера, не должен
 * получить письмо с пустыми кавычками и фразой «эти запросы» ни о чём.
 *
 * ВНИМАНИЕ про частотность: она приходит из fetchVolumes, а тот ходит в Вордстат
 * через XMLRiver. Пока баланс XMLRiver в минусе, карта возвращается пустой,
 * volume равен нулю и предложение про спрос в текст не попадает. Строка вернётся
 * сама, как только источник частотности заработает.
 */
export function buildOutreachMessage(input: MessageInput): string {
	const blocks: string[] = ['Посмотрели ваш сайт в поиске Яндекса.']

	// Позиции: первая строка полная, дальше без повтора слова «месте».
	const shown = input.keywords.slice(0, MAX_KEYWORDS_SHOWN)
	if (shown.length > 0) {
		blocks.push(
			shown
				.map((k, i) =>
					i === 0
						? `По «${k.keyword}» вы на ${k.position} месте`
						: `По «${k.keyword}» - на ${k.position}`,
				)
				.join('\n'),
		)
	}

	// Конкуренты и спрос идут одним абзацем, но каждый может отсутствовать.
	const rivals = input.competitors.slice(0, 2)
	const rivalsPart =
		rivals.length >= 2
			? `Выше вас - ${rivals[0].domain} и ${rivals[1].domain}.`
			: rivals.length === 1
				? `Выше вас - ${rivals[0].domain}.`
				: ''

	const volume = input.volume ?? 0
	// «Эти запросы» без списка запросов выше повисает в воздухе, поэтому цифру
	// показываем только вместе с позициями.
	const volumePart =
		shown.length > 0 && volume >= MIN_VOLUME_SHOWN
			? `Эти запросы ищут ${volume.toLocaleString('ru-RU')} ${plural(volume, 'раз', 'раза', 'раз')} в месяц, и почти весь этот трафик уходит в топ-10.`
			: ''

	const middle = [rivalsPart, volumePart].filter(Boolean).join(' ')
	if (middle) blocks.push(middle)

	blocks.push(
		'Разница простая: в Директе вы платите за каждый клик, из поиска переходы ' +
			'идут бесплатно и постоянно, пока сайт держится наверху.',
	)

	blocks.push(
		'Могу прислать отчет - ваши позиции, кто выше и сколько людей ищет ваши услуги, бесплатно',
	)

	blocks.push('Прислать?')

	return blocks.map(trimDot).join('\n\n')
}

/**
 * Открывающее сообщение — первое касание в Telegram.
 *
 * Структура утверждена заказчиком: обращение по имени и отчеству, фраза про
 * ожидание подходящего дня, вопрос про сайт и подпись «Я по работе».
 *
 * Фраза про день недели меняется в зависимости от того, КОГДА менеджер открыл
 * лида: в выходные пишем «дождался выходных», в будни «ждал будние». Смысл
 * один: показать, что писали не веерной рассылкой в случайный момент, а
 * выбирали время. Поэтому сообщение и не хранится в базе, а собирается при
 * каждом обращении: сохранённый текст к понедельнику начал бы врать.
 *
 * Подпись «Я по работе» обязательна: без неё сообщение от незнакомого аккаунта
 * читается как личное и его закрывают, не дочитав.
 */
export function buildOpeningMessage(input: MessageInput, now: Date = new Date()): string {
	const first = input.firstName?.trim()
	const middle = input.middleName?.trim()
	const name = [first, middle].filter(Boolean).join(' ')

	const day = now.getDay()
	const isWeekend = day === 0 || day === 6
	const waited = isWeekend
		? 'ждал выходные, чтобы вам написать'
		: 'ждал будние, чтобы вам написать'

	const hello = name ? `${name}, здравствуйте, ${waited}` : `Здравствуйте, ${waited}`

	// Пробел перед вопросительным знаком поставлен намеренно, это не опечатка:
	// вплотную к домену «?» попадает внутрь ссылки, которую Telegram строит сам,
	// и адрес в сообщении выглядит битым.
	return `${hello}\n\nМогу с вами пообщаться по поводу сайта - ${input.domain} ?\nЯ по работе`
}
