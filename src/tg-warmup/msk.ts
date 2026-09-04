/**
 * Московское время для окон и расписаний ТГ-модуля.
 *
 * Сервер живёт в UTC: контейнер запускается без TZ, и `new Date().getHours()`
 * там возвращает часы по Гринвичу. А все окна в интерфейсе подписаны «по МСК» —
 * и владелец задаёт их именно так. Пока это не свести, «окно 10:00–20:00»
 * означает 13:00–23:00 по Москве, и человек видит в календаре времена, которые
 * не сходятся с тем, что он выставил.
 *
 * Смещение фиксированное. В России нет перехода на летнее время с 2014 года,
 * так что Москва — это ровно UTC+3 круглый год, и городить работу с базой
 * часовых поясов не из-за чего.
 *
 * Почему не TZ=Europe/Moscow на весь контейнер: тогда вместе с окнами уедут
 * границы суток в статистике, выполнениях и рассылке писем — а их никто не
 * просил трогать. Здесь правится ровно то, что подписано «по МСК».
 */

const MSK_OFFSET_MIN = 180
const MIN = 60_000

/** Часы московского времени для момента. */
export function mskHour(d: Date): number {
	return mskMinuteOfDay(d) / 60 | 0
}

/** Минута московских суток: 0 в полночь по Москве, 1439 в 23:59. */
export function mskMinuteOfDay(d: Date): number {
	const shifted = new Date(d.getTime() + MSK_OFFSET_MIN * MIN)
	return shifted.getUTCHours() * 60 + shifted.getUTCMinutes()
}

/** Ключ московских суток «ГГГГ-ММ-ДД»: по нему считаются дневные нормы. */
export function mskDayKey(d: Date): string {
	const s = new Date(d.getTime() + MSK_OFFSET_MIN * MIN)
	return `${s.getUTCFullYear()}-${String(s.getUTCMonth() + 1).padStart(2, '0')}-${String(s.getUTCDate()).padStart(2, '0')}`
}

/**
 * Момент, у которого московские стрелки показывают заданный час.
 *
 * dayShift считается в московских сутках: 0 — сегодня по Москве, 1 — завтра.
 * Час 24 означает полночь следующих суток — так задаётся конец окна «до 24».
 */
export function mskAt(now: Date, hour: number, dayShift = 0, minute = 0): Date {
	const s = new Date(now.getTime() + MSK_OFFSET_MIN * MIN)
	// Полночь московских суток, выраженная в UTC.
	const midnightUtc = Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate()) - MSK_OFFSET_MIN * MIN
	return new Date(midnightUtc + (dayShift * 24 + hour) * 60 * MIN + minute * MIN)
}

/** Момент по минуте московских суток указанного дня. */
export function mskAtMinute(day: Date, minute: number): Date {
	return mskAt(day, 0, 0, minute)
}
