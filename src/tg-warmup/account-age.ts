import { ID_AGE_ANCHORS } from './id-age-anchors'

/**
 * Оценка даты регистрации аккаунта по его числовому id.
 *
 * Нужна для блока «Возраст» в скоринге — самого тяжёлого, вес 18%. Telegram
 * дату регистрации не отдаёт, но id выдаются по возрастанию, поэтому дата
 * восстанавливается интерполяцией между известными замерами.
 *
 * Точность честная: несколько дней там, где замеры плотные, до пары недель
 * там, где разрежены. Для «свежий / отлежался / старый» этого достаточно,
 * выдавать её как точную дату регистрации нельзя.
 */

type Anchor = { id: number; time: number }

// Замеры выпрямляются один раз при загрузке: сортировка по id и бегущий
// максимум по дате. Без этого пара соседних замеров, идущих вразнобой,
// давала бы отрицательный наклон и дату «из будущего» между ними.
const ANCHORS: Anchor[] = (() => {
	const rows = ID_AGE_ANCHORS.map(([id, date]) => ({ id, time: Date.parse(date + 'T00:00:00Z') }))
		.filter(a => Number.isFinite(a.id) && Number.isFinite(a.time))
		.sort((a, b) => a.id - b.id)
	let max = -Infinity
	for (const a of rows) {
		if (a.time < max) a.time = max
		else max = a.time
	}
	return rows
})()

export type AgeEstimate = {
	/** Оценка даты регистрации. */
	date: Date
	/**
	 * Насколько оценке верить:
	 *   'между'  — id попал между замерами, обычная интерполяция;
	 *   'старше' — id меньше самого раннего замера, аккаунт точно старше даты;
	 *   'позже'  — id больше последнего замера, дата посчитана экстраполяцией.
	 */
	kind: 'между' | 'старше' | 'позже'
	ageDays: number
}

const DAY = 86400000

/**
 * Экстраполяция за последним замером. Наклон берётся по хвосту набора, а не по
 * двум крайним точкам: одна выпадающая пара давала бы дикий разброс.
 */
function tailRate(): number {
	const tail = ANCHORS.slice(-12)
	const first = tail[0]
	const last = tail[tail.length - 1]
	const dIds = last.id - first.id
	const dTime = last.time - first.time
	// Если хвост вырожден, берём среднее по всему набору.
	if (dIds <= 0 || dTime <= 0) {
		const a = ANCHORS[0]
		const b = ANCHORS[ANCHORS.length - 1]
		return (b.time - a.time) / Math.max(1, b.id - a.id)
	}
	return dTime / dIds
}

export function estimateRegistration(userId: number | string, now: Date = new Date()): AgeEstimate | null {
	const id = typeof userId === 'string' ? Number(userId) : userId
	if (!Number.isFinite(id) || id <= 0) return null

	const first = ANCHORS[0]
	const last = ANCHORS[ANCHORS.length - 1]

	const done = (time: number, kind: AgeEstimate['kind']): AgeEstimate => {
		// Дату из будущего не отдаём никогда: экстраполяция обгоняет реальность,
		// а отрицательный возраст сломает скоринг.
		const capped = Math.min(time, now.getTime())
		return { date: new Date(capped), kind, ageDays: Math.max(0, Math.floor((now.getTime() - capped) / DAY)) }
	}

	if (id <= first.id) return done(first.time, 'старше')
	if (id >= last.id) return done(last.time + (id - last.id) * tailRate(), 'позже')

	// Двоичный поиск соседей.
	let lo = 0
	let hi = ANCHORS.length - 1
	while (hi - lo > 1) {
		const mid = (lo + hi) >> 1
		if (ANCHORS[mid].id <= id) lo = mid
		else hi = mid
	}
	const a = ANCHORS[lo]
	const b = ANCHORS[hi]
	const share = b.id === a.id ? 0 : (id - a.id) / (b.id - a.id)
	return done(a.time + share * (b.time - a.time), 'между')
}
