/**
 * Планировщик прогрева. Чистые функции без побочных эффектов и без сети:
 * их можно прогнать тестом и увидеть расписание, не подключаясь к Telegram.
 *
 * Устройство разобрано в progrev-kak-rabotaet.txt, части 4 и 6. Ключевые идеи,
 * которые оттуда взяты и почему:
 *
 *  - У аккаунта есть ПОСТОЯННЫЙ «характер»: средний интервал между действиями
 *    выводится из сида, привязанного к id, и не меняется от запуска к запуску.
 *    Один аккаунт активнее, другой ленивее — как у живых людей.
 *  - Длительность сессии, наоборот, пересчитывается каждый запуск с разбросом
 *    ±22%. Если сто аккаунтов стартуют и финишируют ровно через 72 часа,
 *    это единый паттерн, который видно.
 *  - Лимит растёт с 30% в первый день до 100% к седьмому.
 *  - Одно «действие» плана — это серия микрошагов, а не один вызов API.
 *
 * Отличие от разобранного аналога: у них новый аккаунт получал 3 действия за
 * 3 суток. Формально безопасно, практически бесполезно — истории не создаётся.
 * Здесь новичку даётся 8-15 ЧИТАЮЩИХ действий в день: чтение не порождает
 * исходящей коммуникации, а именно за неё прилетает PEER_FLOOD.
 */

/** Стадия аккаунта по возрасту. От неё зависит и набор действий, и лимиты. */
export type Stage = 'new' | 'warm' | 'mature'

export function stageFor(ageDays: number): Stage {
	if (ageDays < 7) return 'new'
	if (ageDays < 30) return 'warm'
	return 'mature'
}

/**
 * Профиль интенсивности — только ОБЪЁМ действий в сутки.
 *
 * Раньше здесь же лежали лимиты на исходящие, привязанные к стадии: новичку
 * до седьмого дня не разрешалось ничего, кроме чтения. Это оказалось и слишком
 * долго, и слишком грубо. Возраст — один признак из шести, и сам по себе он не
 * говорит, готов ли аккаунт что-то делать: годовалый аккаунт с пустым профилем
 * и нулём диалогов рискует больше, чем трёхдневный, который уже обжился.
 * Решение об исходящих принимает outgoingAllowance ниже, по совокупности.
 */
export type Intensity = {
	stage: Stage
	actionsPerDay: number
}

/**
 * Сколько действий в сутки. Числа подобраны так, чтобы суммарное время в сети
 * оставалось в пределах десяти-сорока минут: столько человек и проводит в
 * мессенджере за день, если не переписывается часами. Прежние пятьдесят
 * действий у зрелого давали под два часа онлайна — это уже не поведение
 * читателя, а работа.
 */
export const INTENSITY: Record<Stage, Intensity> = {
	new: { stage: 'new', actionsPerDay: 10 },
	warm: { stage: 'warm', actionsPerDay: 20 },
	mature: { stage: 'mature', actionsPerDay: 30 },
}

// Сколько первых суток прогрева аккаунт только читает. Двое, а не семь:
// за это время он успевает набрать историю входов и просмотров, но ещё не
// делает ничего, за что можно получить ограничение. Дальше объём исходящих
// определяется готовностью, а не календарём.
export const READ_ONLY_DAYS = 2

export type AllowanceInput = {
	/** Какой день прогрева идёт, начиная с 1. Ноль — прогрев не запущен. */
	dayIndex: number
	/** Возраст по оценке из id. null, если оценить не удалось. */
	ageDays: number | null
	/** Сколько суток аккаунт под нашим управлением. */
	daysManaged: number
	/** Сколько действий мы за ним записали. */
	actionsTotal: number
	dialogs: number
	channels: number
	/** Доля заполненных полей профиля: имя, фамилия, юзернейм, био, фото. */
	profileFilled: number
	spamBlock: 'clean' | 'temporary' | 'permanent' | 'unknown'
	floodWaits: number
	peerFloods: number
}

export type Allowance = {
	/** Разрешены ли сегодня вступления, реакции и сообщения. */
	allowOutgoing: boolean
	maxJoinsPerDay: number
	maxMessagesPerDay: number
	/**
	 * Норма исходящих на сутки ЦЕЛИКОМ, до вычета уже потраченного.
	 *
	 * maxMessagesPerDay по ходу дня уменьшается — это остаток. Для дневной
	 * раскладки нужен именно валовый предел: план строится на сутки, и он не
	 * должен усыхать после каждого отправленного сообщения.
	 */
	dailyMessages: number
	/** Готовность 0-100: та самая совокупная оценка, из которой взяты квоты. */
	readiness: number
	/** Почему сегодня столько — человеческим языком, для карточки аккаунта. */
	notes: string[]
}

/**
 * Сколько исходящих можно аккаунту СЕГОДНЯ.
 *
 * Считается по совокупности, а не по возрасту:
 *   зрелость — сколько аккаунту лет по оценке из id;
 *   выдержка — сколько суток он у нас, а не «сколько ему лет вообще»;
 *   наработка — сколько действий мы за ним уже записали;
 *   обжитость — есть ли диалоги и подписки, то есть похож ли он на живого;
 *   профиль — заполнены ли имя, юзернейм, фото, био;
 *   чистота — были ли FLOOD_WAIT.
 *
 * Ни один признак не решает в одиночку. Зато три условия перекрывают
 * исходящие независимо от суммы, потому что это не «слабые места», а прямые
 * сигналы, что делать сейчас ничего нельзя.
 */
function times(n: number): string {
	const m10 = n % 10
	const m100 = n % 100
	if (m10 === 1 && m100 !== 11) return `${n} раз`
	if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return `${n} раза`
	return `${n} раз`
}

export function outgoingAllowance(i: AllowanceInput): Allowance {
	const notes: string[] = []
	const deny = (why: string): Allowance => ({
		allowOutgoing: false, maxJoinsPerDay: 0, maxMessagesPerDay: 0, dailyMessages: 0,
		readiness: 0, notes: [why],
	})

	// Спамблок — прямой запрет. Писать под ограничением значит его продлить.
	if (i.spamBlock === 'permanent') return deny('Вечный спамблок: исходящие бессмысленны, аккаунт под замену')
	if (i.spamBlock === 'temporary') return deny('Временный спамблок: только чтение, пока не снимут')
	// PEER_FLOOD — вердикт о поведении, а не лимит скорости. После двух
	// возвращаться к исходящим нельзя.
	if (i.peerFloods >= 2) return deny('Дважды получен PEER_FLOOD: исходящие закрыты, оставляем только чтение')
	// Первые сутки прогрева — вход, просмотр, выход. Ничего больше.
	if (i.dayIndex > 0 && i.dayIndex <= READ_ONLY_DAYS) {
		return deny(`День ${i.dayIndex}: первые ${READ_ONLY_DAYS} суток только читаем, набираем историю входов`)
	}

	const share = (value: number, target: number) => Math.max(0, Math.min(1, value / target))
	const signals = {
		зрелость: i.ageDays == null ? 0.3 : share(i.ageDays, 30),
		выдержка: share(i.daysManaged, 7),
		наработка: share(i.actionsTotal, 30),
		обжитость: share(i.dialogs + i.channels, 12),
		профиль: Math.max(0, Math.min(1, i.profileFilled)),
		чистота: i.floodWaits === 0 ? 1 : Math.max(0, 1 - i.floodWaits / 8),
	}
	const values = Object.values(signals)
	const readiness = Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100)

	// Что тянет вниз — показываем, чтобы было понятно, куда добавить.
	const weak = Object.entries(signals)
		.filter(([, v]) => v < 0.5)
		.map(([k]) => k)
	notes.push(`Готовность ${readiness} из 100`)
	if (weak.length) notes.push(`Слабые места: ${weak.join(', ')}`)

	// Квоты по готовности. Ступени, а не формула: между «двумя вступлениями»
	// и «тремя» нет непрерывной величины, а ступени видно в журнале.
	let joins = readiness < 25 ? 1 : readiness < 50 ? 2 : readiness < 75 ? 3 : 4
	let messages = readiness < 30 ? 0 : readiness < 50 ? 1 : readiness < 70 ? 3 : readiness < 85 ? 5 : 8

	// Разгон не заканчивается вместе с чтением: с третьего дня даём половину,
	// с седьмого — всё. Иначе выход из режима чтения выглядит как рубильник.
	const dayFactor = i.dayIndex === 0 ? 1 : i.dayIndex <= 4 ? 0.5 : i.dayIndex <= 6 ? 0.75 : 1
	if (i.dayIndex === 0) notes.push('Прогрев не запущен: показана норма на случай запуска')
	if (dayFactor < 1) {
		joins = Math.max(1, Math.round(joins * dayFactor))
		messages = Math.floor(messages * dayFactor)
		notes.push(`День ${i.dayIndex}: пока ${Math.round(dayFactor * 100)}% от нормы, разгон до седьмого дня`)
	}

	// Писать, не имея ни одного чата, — само по себе странно. Сначала подписки.
	if (i.dialogs + i.channels < 3) {
		messages = 0
		notes.push('Пока меньше трёх чатов: сначала вступления и чтение, сообщения потом')
	}
	// FLOOD_WAIT отдельным правилом, а не только признаком «чистота». В среднем
	// по шести признакам он размывается: аккаунт с шестью флудами, но хорошим
	// профилем и историей, получал полную норму. Это ровно тот аккаунт, которому
	// Telegram уже шесть раз сказал сбавить.
	if (i.floodWaits >= 6) {
		joins = Math.min(joins, 1)
		messages = 0
		notes.push(`FLOOD_WAIT ${times(i.floodWaits)}: исходящие почти закрыты, дайте аккаунту отлежаться на чтении`)
	} else if (i.floodWaits >= 3) {
		joins = Math.max(1, Math.floor(joins / 2))
		messages = Math.floor(messages / 2)
		notes.push(`FLOOD_WAIT ${times(i.floodWaits)}: норма исходящих урезана вдвое`)
	}
	// Один PEER_FLOOD — не приговор, но исходящие режем вдвое.
	if (i.peerFloods === 1) {
		joins = Math.max(1, Math.floor(joins / 2))
		messages = Math.floor(messages / 2)
		notes.push('Был PEER_FLOOD: норма исходящих урезана вдвое')
	}

	return {
		allowOutgoing: joins > 0 || messages > 0,
		maxJoinsPerDay: joins,
		maxMessagesPerDay: messages,
		dailyMessages: messages,
		readiness,
		notes,
	}
}

/**
 * Устойчивый сид из строки. Нужен, чтобы «характер» аккаунта не менялся
 * между перезапусками сервиса: Math.random здесь недопустим.
 */
export function accountSeed(accountId: string): number {
	let h = 2166136261
	for (let i = 0; i < accountId.length; i++) {
		h ^= accountId.charCodeAt(i)
		h = Math.imul(h, 16777619)
	}
	return h >>> 0
}

/** Детерминированный генератор: одинаковый сид даёт одинаковую последовательность. */
export function makeRng(seed: number): () => number {
	let s = seed >>> 0 || 1
	return () => {
		s ^= s << 13
		s >>>= 0
		s ^= s >> 17
		s ^= s << 5
		s >>>= 0
		return s / 4294967296
	}
}

/** Значение с разбросом: 100 при spread 0.2 даёт число из [80, 120]. */
function jitter(value: number, spread: number, rnd: () => number): number {
	return value * (1 - spread + rnd() * spread * 2)
}

/**
 * Длительность одной сессии прогрева в минутах.
 * Пересчитывается на каждый запуск, поэтому принимает runIndex.
 */
export function sessionMinutes(nominalDays: number, seed: number, runIndex: number): number {
	const rnd = makeRng(seed + runIndex * 7919)
	return Math.round(jitter(nominalDays * 24 * 60, 0.22, rnd))
}

/**
 * «Характер» аккаунта: множитель темпа, постоянный на всю жизнь аккаунта.
 * Около 1.0 с разбросом ±18%: один аккаунт чуть тороплив, другой ленив.
 *
 * Именно множитель, а не готовый интервал в минутах. Интервал зависит ещё и от
 * того, сколько времени доступно в окнах активности и сколько действий на
 * сегодня: с фиксированным интервалом план на 12 действий не влезал в окна
 * и молча обрезался до четырёх.
 */
export function paceFactor(seed: number): number {
	return jitter(1, 0.18, makeRng(seed))
}

/** Средний интервал между действиями с учётом доступного времени и характера. */
export function avgIntervalMinutes(seed: number, availableMinutes: number, actions: number): number {
	const base = availableMinutes / Math.max(1, actions)
	return Math.max(1, Math.round(base * paceFactor(seed)))
}

/**
 * Доля дневного лимита на N-й день прогрева: 30% в первый, 100% к седьмому.
 * dayIndex начинается с 1.
 */
export function rampFactor(dayIndex: number): number {
	if (dayIndex <= 1) return 0.3
	if (dayIndex >= 7) return 1
	return 0.3 + ((dayIndex - 1) / 6) * 0.7
}

/** Сколько действий положено в конкретный день прогрева. */
export function actionsForDay(intensity: Intensity, dayIndex: number): number {
	return Math.max(1, Math.round(intensity.actionsPerDay * rampFactor(dayIndex)))
}

export type Window = { fromHour: number; toHour: number }

/**
 * Сеанс — один заход в Telegram: аккаунт вышел в сеть, несколько минут что-то
 * смотрел и вышел.
 *
 * Раньше план был плоским списком моментов, и на каждое действие делался
 * отдельный вход. Живой человек так не пользуется мессенджером: он открывает
 * его несколько раз в день и каждый раз проводит там минуты, а не одну секунду.
 * Заодно это отвечает на вопрос «сколько аккаунт работает»: суммарно
 * десять-двадцать минут в сутки, а не круглосуточно.
 */
export type Session = {
	/** Минута суток, когда заходим. */
	startMin: number
	/** Сколько минут держимся в сети. */
	minutes: number
	/** Сколько действий делаем за заход. */
	actions: number
}

/** Сколько заходов в день по стадии: у новичка их меньше, чем у зрелого. */
function sessionsPerDay(stage: Stage, rnd: () => number): number {
	const base = stage === 'new' ? 2 : stage === 'warm' ? 3 : 4
	return base + (rnd() < 0.4 ? 1 : 0)
}

export type DayPlan = {
	stage: Stage
	/** Всего действий за сутки. */
	actions: number
	/** Всего минут в сети за сутки. */
	minutes: number
	sessions: Session[]
}

/**
 * План на сутки: когда заходим, насколько и что успеваем.
 *
 * Заходы раскладываются только внутри окон активности и не наезжают друг на
 * друга: между ними не меньше сорока минут, иначе это один длинный заход,
 * разбитый пополам, а не два разных.
 */
export function planDay(opts: {
	accountId: string
	dayIndex: number
	runIndex: number
	ageDays: number
	windows: Window[]
	timezoneOffsetMin?: number
}): DayPlan {
	const stage = stageFor(opts.ageDays)
	const intensity = INTENSITY[stage]
	const seed = accountSeed(opts.accountId)
	const rnd = makeRng(seed + opts.dayIndex * 104729 + opts.runIndex * 31)
	const actions = actionsForDay(intensity, opts.dayIndex)

	const windows = opts.windows.length ? opts.windows : [{ fromHour: 9, toHour: 23 }]
	const slots = windows.map(w => ({ start: w.fromHour * 60, len: Math.max(0, (w.toHour - w.fromHour) * 60) }))
	const total = slots.reduce((s, w) => s + w.len, 0)
	if (total <= 0) return { stage, actions: 0, minutes: 0, sessions: [] }

	const count = Math.max(1, Math.min(sessionsPerDay(stage, rnd), actions))

	// Действия раскидываем по заходам неровно: два-три подряд и один короткий
	// куда правдоподобнее, чем поровну.
	const per: number[] = new Array(count).fill(Math.floor(actions / count))
	for (let i = 0; i < actions % count; i++) per[i]++
	for (let i = 0; i < count - 1 && rnd() < 0.5; i++) {
		if (per[i] > 1) {
			per[i]--
			per[i + 1]++
		}
	}

	// Моменты заходов: делим доступное время на равные доли и внутри каждой
	// берём случайную точку. Так заходы и разнесены, и не выстроены по сетке.
	const share = total / count
	const sessions: Session[] = []
	for (let i = 0; i < count; i++) {
		const offset = i * share + rnd() * share * 0.7
		let left = offset
		let startMin = slots[0].start
		for (const w of slots) {
			if (left < w.len) {
				startMin = Math.round(w.start + left)
				break
			}
			left -= w.len
		}
		// Около минуты на действие плюс минута «осмотреться». Действие — это
		// короткая серия вызовов с паузами на чтение, а не мгновенный запрос.
		const minutes = Math.max(2, Math.min(18, Math.round(per[i] * (0.6 + rnd() * 0.8) + 1)))
		sessions.push({ startMin, minutes, actions: per[i] })
	}

	sessions.sort((a, b) => a.startMin - b.startMin)
	// Слипшиеся заходы разводим: ближе сорока минут — это один заход, а не два.
	for (let i = 1; i < sessions.length; i++) {
		const min = sessions[i - 1].startMin + sessions[i - 1].minutes + 40
		if (sessions[i].startMin < min) sessions[i].startMin = min
	}

	const last = slots[slots.length - 1]
	const dayEnd = last.start + last.len
	const fitting = sessions.filter(s => s.startMin + s.minutes <= dayEnd)

	return {
		stage,
		actions: fitting.reduce((s, x) => s + x.actions, 0),
		minutes: fitting.reduce((s, x) => s + x.minutes, 0),
		sessions: fitting,
	}
}

/**
 * Момент запуска суточного прогрева: случайная минута внутри первого окна.
 * Владелец просил «каждый день в какое-то случайное время внутри окна».
 * Сид включает дату, поэтому время разное каждый день, но воспроизводимое.
 */
export function dailyStartMinute(accountId: string, dateKey: string, windows: Window[]): number {
	const w = windows[0] ?? { fromHour: 9, toHour: 23 }
	const rnd = makeRng(accountSeed(accountId + dateKey))
	const span = Math.max(1, (w.toHour - w.fromHour) * 60)
	// Стартуем в первой трети окна, чтобы успеть разложить весь день.
	return Math.round(w.fromHour * 60 + rnd() * span * 0.33)
}

/**
 * Раскладка дневной цели по аккаунтам.
 *
 * Владелец ставит одну цифру на всю рассылку — «двадцать сообщений за день», —
 * а кому сколько, решается по готовности: прогретый аккаунт тянет больше,
 * слабый меньше. Смысл не в справедливости, а в том, чтобы норма ложилась туда,
 * где она безопаснее.
 *
 * Три правила, которые важнее пропорции:
 *   - у кого закрыты исходящие, тот не получает ничего, сколько бы ни осталось;
 *   - ничей личный потолок не превышается, даже если цель не набирается;
 *   - остаток от округления и от упёршихся в потолок раздаётся тем, у кого
 *     ещё есть место, по той же готовности.
 */
export type DistributionInput = { id: string; readiness: number; canSend: boolean; cap: number }

export function distributeDaily(goal: number, accounts: DistributionInput[]): Map<string, number> {
	const out = new Map<string, number>()
	for (const a of accounts) out.set(a.id, 0)

	const eligible = accounts.filter(a => a.canSend && a.cap > 0)
	if (goal <= 0 || !eligible.length) return out

	// Готовность ноль у всех бывает на свежем пуле. Тогда делим поровну:
	// это честнее, чем не отправить ничего.
	const totalReadiness = eligible.reduce((s, a) => s + Math.max(0, a.readiness), 0)
	const weight = (a: DistributionInput) => (totalReadiness > 0 ? Math.max(0, a.readiness) : 1)

	let left = Math.min(
		goal,
		eligible.reduce((s, a) => s + a.cap, 0), // больше суммы потолков не раздать
	)

	// Несколько проходов: на каждом раздаём остаток пропорционально среди тех,
	// у кого ещё есть место. Обычно хватает двух, ограничение — от зацикливания.
	for (let pass = 0; pass < 10 && left > 0; pass++) {
		const room = eligible.filter(a => (out.get(a.id) ?? 0) < a.cap)
		if (!room.length) break
		const sum = room.reduce((s, a) => s + weight(a), 0)
		if (sum <= 0) break

		let given = 0
		// По убыванию готовности: при делёжке остатка лишняя единица должна
		// доставаться самому прогретому, а не первому попавшемуся.
		for (const a of [...room].sort((x, y) => y.readiness - x.readiness)) {
			if (given >= left) break
			const share = Math.floor((left * weight(a)) / sum)
			const add = Math.min(share, a.cap - (out.get(a.id) ?? 0), left - given)
			if (add <= 0) continue
			out.set(a.id, (out.get(a.id) ?? 0) + add)
			given += add
		}
		// Пропорция могла не раздать ничего из-за округления вниз — тогда
		// доводим поштучно, иначе цикл встанет с недоданным остатком.
		if (given === 0) {
			for (const a of [...room].sort((x, y) => y.readiness - x.readiness)) {
				if (given >= left) break
				if ((out.get(a.id) ?? 0) >= a.cap) continue
				out.set(a.id, (out.get(a.id) ?? 0) + 1)
				given++
			}
		}
		left -= given
		if (given === 0) break
	}
	return out
}
