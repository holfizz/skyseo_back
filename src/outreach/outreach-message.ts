// Сообщение приглашает на бесплатный разбор; полный отчет и цену не отправляем.
//
// В самом тексте не должно быть длинных тире и буквы «ё»: заказчик считает,
// что они выдают машинный набор.

import { normalizeName } from '../common/normalize-name'
import { displayDomain } from '../common/domain'

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
 * Окно позиций, из которого берём запросы для текста.
 *
 * Лид попадает в рассылку из-за ОДНОГО запроса, где он на 15-50 месте, но по
 * другим запросам того же прогона он может стоять в топ-3. Раньше в письмо
 * подставлялись его ЛУЧШИЕ позиции, и получалось «вы на 1 месте, выше вас
 * такие-то, давайте поднимем в топ-10». Разговор на этом заканчивался.
 *
 * Берём только те запросы, где человеку есть что улучшать.
 */
export const MESSAGE_POSITION_MIN = 10
export const MESSAGE_POSITION_MAX = 50

/**
 * Спрос по показанным запросам.
 *
 * В сообщении он не фигурирует: частотность требует отдельной проверки.
 * Функция остается для импорта и оценки лида.
 */
export function sumShownVolume(keywords: MessageKeyword[], volumes: Map<string, number>): number {
	return keywords
		.slice(0, MAX_KEYWORDS_SHOWN)
		.reduce((sum, k) => sum + (volumes.get(k.keyword) ?? 0), 0)
}

/**
 * Точка в конце абзаца не ставится, внутри абзаца остаётся.
 *
 * Точка между предложениями остается,
 * а на последнем слове абзаца её быть не должно, иначе текст выглядит как
 * официальное письмо, а не как сообщение живого человека в мессенджере.
 *
 * финальную точку снимаем, вопросительный знак оставляем.
 */
function trimDot(text: string): string {
	return text.replace(/\.$/, '')
}

/**
 * Второе сообщение — уходит после того, как человек ответил на открывающее.
 *
 * Структура: что увидели, кто выше, чем занимаемся и приглашение на созвон.
 * Первые два блока собираются из данных и ПРОПУСКАЮТСЯ,
 * если данных нет: лид, заведённый руками без прогона парсера, не должен
 * получить письмо с пустыми кавычками и фразой «эти запросы» ни о чём.
 * Последние два блока постоянные — это рассказ о нас, он от данных не зависит.
 *
 * Позиции идут одной фразой, а не столбиком: списком это читается как отчёт
 * робота, а нужен разговор.
 */
export function buildOutreachMessage(input: MessageInput): string {
	const blocks: string[] = []

	// Позиции: первая с словом «месте», дальше без повтора.
	const shown = input.keywords.slice(0, MAX_KEYWORDS_SHOWN)
	if (shown.length > 0) {
		const parts = shown.map((k, i) =>
			i === 0 ? `по «${k.keyword}» вы на ${k.position} месте` : `по «${k.keyword}» на ${k.position}`,
		)
		blocks.push(`Посмотрел ваш сайт в поиске Яндекса - ${parts.join(', ')}.`)
	} else {
		blocks.push('Посмотрел ваш сайт в поиске Яндекса.')
	}

	const rivals = input.competitors.slice(0, 2)
	if (rivals.length >= 2) {
		blocks.push(`В сохраненной выдаче выше вас ${displayDomain(rivals[0].domain)} и ${displayDomain(rivals[1].domain)}.`)
	} else if (rivals.length === 1) {
		blocks.push(`В сохраненной выдаче выше вас ${displayDomain(rivals[0].domain)}.`)
	}

	blocks.push('Я занимаюсь SEO и видимостью сайтов в ответах нейросетей. По вашему сайту видимость в нейропоиске пока отдельно не проверял.')
	blocks.push('Было бы вам интересно узнать больше про свой сайт? На бесплатном 15-минутном созвоне покажу позиции, кто выше в выдаче и какой спрос у проверенных запросов.')

	return blocks.map(trimDot).join('\n\n')
}

// Доменные зоны второго уровня: после срезания «.uk» надо срезать и «.co».
const SECOND_LEVEL = ['com', 'co', 'net', 'org']

/**
 * Имя сайта без зоны: «dreamsstore.ru» → «dreamsstore».
 *
 * В первом сообщении зона только мешает: она не несёт смысла, а адрес с точкой
 * Telegram превращает в ссылку, и живое обращение начинает выглядеть рассылкой.
 * В остальных текстах домены остаются целиком: там это чужие сайты, и по
 * огрызку конкурента лид его не узнает.
 */
export function siteName(domain: string): string {
	const clean = displayDomain(domain)
	const parts = clean.split('.')
	if (parts.length < 2) return clean
	parts.pop()
	if (parts.length > 1 && SECOND_LEVEL.includes(parts[parts.length - 1])) parts.pop()
	return parts.join('.')
}

/**
 * Открывающее сообщение — первое касание в Telegram. Короткое: обращение по
 * имени и отчеству и вопрос про сайт.
 *
 * Пробел перед вопросительным знаком поставлен намеренно, так утвердил заказчик.
 * Изначально он спасал от того, что Telegram затягивал «?» внутрь ссылки; теперь
 * зону из домена срезает siteName и ссылки не возникает вовсе, но вид строки
 * остаётся прежним.
 */
export function buildOpeningMessage(input: MessageInput): string {
	// ФИО капсом («КСЕНИЯ ВЛАДИМИРОВНА») приводим к обычному виду, каждое поле
	// отдельно (см. normalizeName).
	const name = [input.firstName, input.middleName].map(normalizeName).filter(Boolean).join(' ')

	const hello = name ? `${name}, здравствуйте` : 'Здравствуйте'

	return `${hello}\nБыло бы вам интересно узнать, как сейчас сайт ${siteName(input.domain)} виден в поиске?`
}
