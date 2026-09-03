/**
 * Расписание рассылки: кому, когда и с какого аккаунта.
 *
 * Отдельным файлом и без обращений к базе — как warmup-plan.ts рядом. Раскладка
 * очереди по времени это единственная арифметика во всей рассылке, где легко
 * ошибиться незаметно: пропущенный день, аккаунт с выбранной нормой, время за
 * границей окна. Чистую функцию можно прогнать на выдуманных данных и увидеть,
 * что получилось, а внутри сервиса её пришлось бы проверять живой отправкой.
 */

/** Начало окна в указанный день от сегодняшнего (0 — сегодня, 1 — завтра). */
export function windowStart(now: Date, hour: number, dayShift: number): Date {
	const d = new Date(now)
	d.setDate(d.getDate() + dayShift)
	d.setHours(hour, 0, 0, 0)
	return d
}

/** Слот аккаунта в расписании: свой курсор времени и своя дневная норма. */
export type PlanSlot = {
	id: string
	/** Норма на сутки. При переходе на следующий день ею восстанавливается left. */
	quota: number
	/** Сколько сообщений аккаунту осталось в текущем дне плана. */
	left: number
	/** Куда дошло время этого аккаунта. */
	cursor: number
	/** Раньше этого момента аккаунт трогать нельзя: пауза после ошибки. */
	floor: number
	/** Какой день плана сейчас разбирается: 0 — сегодня. */
	day: number
}

/**
 * Разложить очередь по времени и аккаунтам.
 *
 * Аккаунт каждому адресату достаётся СЛУЧАЙНО — среди тех, у кого ещё есть
 * норма на день и не кончилось окно. Не «кто освободится раньше»: при таком
 * выборе пул работает конвейером, аккаунты идут строго по кругу с ровным
 * шагом, и эта регулярность видна со стороны. Случайный выбор даёт неровную
 * картину, которая и должна получаться, когда пишут живые люди.
 *
 * Но случайность взвешенная — по остатку нормы. Равномерный жребий свёл бы на
 * нет всю раскладку дневной цели по готовности: аккаунту с нормой 5 доставалось
 * бы столько же, сколько прогретому с нормой 20, пока норма не кончится.
 * С весами прогретый выпадает чаще ровно во столько раз, во сколько ему больше
 * положено, а к концу дня остатки выравниваются сами.
 *
 * Пауза между сообщениями одного аккаунта тоже случайная, из тех же границ,
 * что потом ставит отправщик.
 *
 * Дни переключаются все разом: пока хоть у кого-то осталась норма на сегодня,
 * следующий адресат достаётся ему, и только когда норму выбрали все, очередь
 * переезжает на следующий день. Иначе аккаунт с большой нормой уехал бы на
 * неделю вперёд, пока остальные простаивают.
 */
/**
 * Начальный курсор аккаунта.
 *
 * Если у аккаунта стоит своё время (первый выход раскидан при запуске или он
 * на паузе после ошибки) — берём его как есть. Если нет, отсчитываем от
 * позднейшего из «сейчас» и начала окна, добавляя случайный сдвиг: иначе весь
 * пул выходит одновременно.
 */
export function startCursor(
	now: Date,
	c: { windowFrom: number; windowTo: number },
	floor: number,
): number {
	const base = Math.max(now.getTime(), windowStart(now, c.windowFrom, 0).getTime())
	if (floor > 0) return Math.max(base, floor)
	const spread = Math.min(45 * 60_000, (c.windowTo - c.windowFrom) * 3600_000 * 0.25)
	return base + Math.random() * spread
}

export function planQueue(
	ids: string[],
	slots: PlanSlot[],
	c: { windowFrom: number; windowTo: number; minIntervalSec: number; maxIntervalSec: number },
	now: Date,
	maxDays = 60,
): Map<string, { at: Date; accountId: string }> {
	const out = new Map<string, { at: Date; accountId: string }>()
	if (!slots.length) return out

	const pause = () => {
		const min = Math.max(30, c.minIntervalSec)
		const max = Math.max(min, c.maxIntervalSec)
		return (min + Math.random() * (max - min)) * 1000
	}
	const usable = () => slots.filter(s => s.left > 0 && s.cursor < windowStart(now, c.windowTo, s.day).getTime())

	/**
	 * Случайный сдвиг начала дня — свой у каждого аккаунта.
	 *
	 * Без него все аккаунты просыпаются ровно в начало окна: 10:00, 10:00,
	 * 10:00 — и так каждый день. Одновременный выход всего пула в одну минуту
	 * видно со стороны лучше, чем что угодно другое, и паузами между
	 * сообщениями это уже не исправить. При запуске первый выход раскидывает
	 * scheduleStart, но со второго дня раскладка целиком на планировщике.
	 */
	const jitter = () => Math.random() * Math.min(45 * 60_000, (c.windowTo - c.windowFrom) * 3600_000 * 0.25)

	/** Жребий с весами: чем больше у аккаунта осталось нормы, тем чаще выпадает. */
	const weighted = (pool: PlanSlot[]): PlanSlot => {
		const total = pool.reduce((sum, s) => sum + s.left, 0)
		let n = Math.random() * total
		for (const s of pool) {
			n -= s.left
			if (n <= 0) return s
		}
		return pool[pool.length - 1]
	}

	for (const id of ids) {
		let ready = usable()
		while (!ready.length) {
			// Норму выбрали все или окно кончилось — вся очередь переезжает на
			// следующий день. Пауза после ошибки при этом сохраняется: floor
			// может отбросить аккаунт и через начало окна.
			const day = Math.max(...slots.map(s => s.day)) + 1
			if (day > maxDays) break
			if (!slots.some(s => s.quota > 0)) break
			for (const s of slots) {
				s.day = day
				s.cursor = Math.max(windowStart(now, c.windowFrom, day).getTime() + jitter(), s.floor)
				s.left = s.quota
			}
			ready = usable()
		}
		// Планировать больше некуда: либо ни у кого нет нормы, либо упёрлись в
		// предел по дням. Остаток очереди останется без времени — и это видно.
		if (!ready.length) break

		const s = weighted(ready)
		out.set(id, { at: new Date(s.cursor), accountId: s.id })
		s.cursor += pause()
		s.left--
	}
	return out
}
