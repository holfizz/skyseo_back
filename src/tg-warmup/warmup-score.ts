/**
 * Оценка Telegram-аккаунта. Чистые функции, без сети и без базы.
 *
 * Строится по разбору в progrev-kak-rabotaet.txt, часть 8: семь блоков со
 * своими весами, шкала 1.0-10.0, жёсткие вето поверх суммы баллов.
 *
 * Сознательно НЕ модель машинного обучения. Размеченных данных нет, а честный
 * прозрачный чек-лист можно объяснить и показать владельцу: видно, какой блок
 * просел и что чинить. Когда накопится телеметрия по нескольким сотням
 * аккаунтов, поверх этого можно будет считать настоящую выживаемость.
 */

/** Что удалось прочитать из аккаунта за один заход, без единого пишущего вызова. */
export type AccountProbe = {
	ageDays: number | null // возраст по user_id, null если не оценён
	oldestSessionDays: number | null
	hasFirstName: boolean
	hasLastName: boolean
	hasUsername: boolean
	hasBio: boolean
	photoCount: number
	activeSessions: number
	premium: boolean
	twoFactor: boolean
	dialogs: number
	channels: number
	contacts: number
	/**
	 * Сколько сообщений в личных переписках накопилось за всю жизнь аккаунта,
	 * включая то, что было до нас. Оценка по номеру последнего сообщения.
	 */
	historyMessages: number | null
	/** Возраст самой старой переписки: сколько аккаунтом реально пользовались. */
	oldestDialogDays: number | null
	/** Исходящие, которые сделали МЫ. Своя работа, а не унаследованная. */
	outgoingTotal: number
	spamBlock: 'clean' | 'temporary' | 'permanent' | 'unknown'
	frozen: boolean
	banned: boolean
	/** Менялся ли фингерпринт устройства: 0 — никогда, 1 — один раз, 2+ — постоянно. */
	fingerprintChanges: number
}

/** Что накопили мы сами, пока аккаунт под нашим управлением. */
export type AccountTelemetry = {
	daysManaged: number
	warmupDaysDone: number
	actionsTotal: number
	activeDaysLast30: number
	/** Действий по дням за последние 30 суток — для оценки равномерности. */
	actionsPerDay: number[]
	firstDayActionShare: number // доля действий в первые сутки от всех
	floodWaits: number
	peerFloods: number
	revives: number // сколько раз аккаунт умирал и возвращался
	reauths: number
}

export type AccountOrigin = {
	numberGeo: string | null // ISO-код страны номера
	proxyType: 'mobile' | 'residential' | 'datacenter' | null
	proxyGeo: string | null
	proxyAlive: boolean
	/** Сколько НАШИХ аккаунтов сидит на том же IP или подсети. */
	neighborsOnIp: number
	ipStability: 'fixed' | 'subnet' | 'roaming'
	langCode: string | null
	supplier: string | null
	batchSize: number | null // сколько аккаунтов залито одной пачкой
}

export type ScoreInput = {
	probe: AccountProbe
	telemetry: AccountTelemetry
	origin: AccountOrigin
}

/**
 * Выживаемость по гео на 30-й день. Взято как стартовый приор из бенчмарка
 * в отчёте (часть 7.5). Заменить на собственную статистику, как только
 * накопится своя: чужие цифры сняты на чужом парке и чужих поставщиках.
 */
export const GEO_SURVIVAL: Record<string, number> = {
	RU: 85.6, UA: 84.7, KZ: 81.5, TR: 80.0, AR: 77.4, TJ: 76.8, BR: 76.1,
	UZ: 72.7, GB: 71.5, PL: 69.8, DE: 69.1, US: 68.5, IN: 68.1, CL: 67.1,
	MM: 66.0, TH: 64.0, CA: 62.3, CO: 60.8, ID: 60.7, BD: 56.4,
}

const WEIGHTS = {
	age: 18,
	identity: 16,
	network: 15,
	behavior: 14,
	restrictions: 13,
	recovery: 12,
	origin: 12,
} as const

export type BlockKey = keyof typeof WEIGHTS

/** Ступенчатая шкала: первое правило, под которое подходит значение. */
function steps(value: number, table: Array<[number, number]>, top: number): number {
	for (const [limit, score] of table) if (value <= limit) return score
	return top
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

/** Балл блока и признак «данных нет». Блок без данных в итог не идёт вовсе. */
type Block = { value: number; hasData: boolean }

function blockAge(p: AccountProbe, t: AccountTelemetry): number {
	const byId = p.ageDays == null ? 30 : steps(p.ageDays, [[2, 0], [7, 30], [30, 60], [90, 85]], 100)
	const managed = steps(t.daysManaged * 24, [[2, 0], [24, 40], [24 * 7, 70]], 100)
	const session = p.oldestSessionDays == null ? 40 : steps(p.oldestSessionDays, [[1, 20], [7, 50], [30, 80]], 100)
	// Возраст по номеру говорит, когда аккаунт ЗАВЕЛИ, а возраст самой старой
	// переписки — когда им начали пользоваться. Между ними бывает пропасть:
	// зарегистрирован два года назад, а первое сообщение позавчера.
	const used = p.oldestDialogDays == null ? 50 : steps(p.oldestDialogDays, [[7, 20], [30, 50], [90, 75]], 100)
	return avg([byId, managed, session, used])
}

function blockIdentity(p: AccountProbe): number {
	const filled =
		(p.hasFirstName ? 20 : 0) + (p.hasLastName ? 20 : 0) + (p.hasUsername ? 20 : 0) +
		(p.hasBio ? 20 : 0) + (p.photoCount > 0 ? 20 : 0)
	// Фингерпринт обязан быть закреплён за аккаунтом навсегда. Плавающее
	// устройство — самый заметный признак фермы из всего блока.
	const fp = p.fingerprintChanges === 0 ? 100 : p.fingerprintChanges === 1 ? 50 : 0
	const sessions = steps(p.activeSessions, [[1, 100], [3, 70]], 30)
	const bonus = (p.premium ? 10 : 0) + (p.twoFactor ? 10 : 0)
	return Math.min(100, avg([filled, fp, sessions]) + bonus)
}

function blockNetwork(o: AccountOrigin): number {
	// Неизвестный тип канала — это «ещё не проверяли», а не «дата-центр».
	// Раньше тип вводили руками и он был всегда, теперь его определяет проверка,
	// и до неё ноль занижал бы оценку на ровном месте. Берём середину, как и
	// для остальных неизвестных в этом блоке.
	const type = o.proxyType === 'mobile' ? 100 : o.proxyType === 'residential' ? 80 : o.proxyType === 'datacenter' ? 30 : 50
	const geoMatch = !o.proxyGeo || !o.numberGeo ? 40 : o.proxyGeo === o.numberGeo ? 100 : 0
	const stability = o.ipStability === 'fixed' ? 100 : o.ipStability === 'subnet' ? 70 : 0
	const neighbors = steps(o.neighborsOnIp, [[1, 100], [3, 70], [10, 40]], 0)
	return avg([type, geoMatch, stability, neighbors])
}

function blockBehavior(p: AccountProbe, t: AccountTelemetry): number {
	const dialogs = steps(p.dialogs, [[0, 0], [5, 40], [20, 75]], 100)
	const channels = steps(p.channels, [[0, 0], [5, 50], [30, 90]], 100)
	const contacts = steps(p.contacts, [[0, 0], [10, 60]], 100)
	// Накопленная переписка — то, чего не подделать прогревом за неделю, и
	// главное, чем купленный живой аккаунт отличается от свежерождённого.
	const history = p.historyMessages == null
		? 40
		: steps(p.historyMessages, [[0, 0], [50, 45], [300, 75], [1500, 92]], 100)
	// Наши собственные исходящие считаем отдельно и мягче: это работа за дни,
	// а не за годы, и требовать от неё сотен сообщений бессмысленно.
	const outgoing = steps(p.outgoingTotal, [[0, 20], [20, 55]], 100)
	const activeDays = steps(t.activeDaysLast30, [[0, 0], [7, 40], [20, 80]], 100)
	// Ровный поток лучше рывка: считаем коэффициент вариации по дням.
	const m = avg(t.actionsPerDay)
	const cv = m > 0 ? Math.sqrt(avg(t.actionsPerDay.map(x => (x - m) ** 2))) / m : 1
	const evenness = Math.max(0, 100 - cv * 60)
	// «Залили и сразу погнали» — прямой штраф.
	const burst = t.firstDayActionShare > 0.5 ? 0 : 100
	return avg([dialogs, channels, contacts, history, outgoing, activeDays, evenness, burst])
}

function blockRestrictions(p: AccountProbe, t: AccountTelemetry): number {
	const status = p.spamBlock === 'clean' ? 100 : p.spamBlock === 'temporary' ? 30 : p.spamBlock === 'permanent' ? 0 : 60
	// PEER_FLOOD это поведенческий вердикт, а не лимит скорости: один такой
	// инцидент весит больше десяти FLOOD_WAIT.
	const floods = Math.max(0, 100 - t.floodWaits * 5)
	const peer = t.peerFloods === 0 ? 100 : t.peerFloods === 1 ? 40 : 0
	return avg([status, floods, peer])
}

function blockRecovery(t: AccountTelemetry): number {
	const revives = steps(t.revives, [[0, 100], [1, 60], [2, 30]], 0)
	const reauths = Math.max(0, 100 - t.reauths * 20)
	return avg([revives, reauths])
}

function blockOrigin(o: AccountOrigin): number {
	const geo = o.numberGeo && GEO_SURVIVAL[o.numberGeo] != null
		? ((GEO_SURVIVAL[o.numberGeo] - 55) / (86 - 55)) * 100
		: 50
	const lang = !o.langCode || !o.numberGeo ? 50 : o.langCode.toUpperCase().startsWith(o.numberGeo) ? 100 : 60
	// Пачка в сотни аккаунтов за минуту — сама по себе маркер.
	const batch = o.batchSize == null ? 70 : steps(o.batchSize, [[10, 100], [50, 80], [200, 50]], 20)
	return avg([Math.max(0, Math.min(100, geo)), lang, batch])
}

export type ScoreResult = {
	/** Итог по шкале 1.0-10.0, как у разобранного аналога. */
	score: number
	category: 'низкий' | 'средний' | 'хороший' | 'высокий'
	blocks: Record<BlockKey, number>
	/** Блоки, по которым данных ещё нет: в итоговый балл они не вошли. */
	noData: BlockKey[]
	/** Сработавшее вето, если есть: тогда score = 1.0 независимо от баллов. */
	/** Приговор аккаунту: тогда score = 1.0 независимо от баллов. */
	veto: string | null
	/**
	 * Помеха, из-за которой аккаунт нельзя использовать прямо сейчас, хотя сам
	 * он в порядке. Балл при этом НЕ обнуляется.
	 */
	blocked: string | null
	warmness: Warmness
	advice: Advice[]
}

/** Прогретость — отдельная метрика, часть 8.12 отчёта. */
export type Warmness = {
	total: number
	endurance: number // выдержка, 30%
	activity: number // накопленная активность, 30%
	fullness: number // наполненность профиля, 25%
	cleanliness: number // чистота истории, 15%
	ready: boolean
}

export type Advice = { level: 'стоп' | 'важно' | 'совет'; text: string }

function warmness(p: AccountProbe, t: AccountTelemetry): Warmness {
	const endurance = Math.min(100, (t.daysManaged / 7) * 100)
	// Накопленная активность считается за ВСЁ время под нашим управлением, а не
	// за текущий прогон: аккаунт, который грели трижды по неделе, прогрет
	// сильнее, чем тот, что первый день на первом прогоне.
	const byActions = Math.min(100, (t.actionsTotal / 40) * 100)
	const byDays = Math.min(100, (t.activeDaysLast30 / 5) * 100)
	const activity = Math.min(byActions, byDays)
	const fullness = avg([
		(p.hasFirstName ? 25 : 0) + (p.hasUsername ? 25 : 0) + (p.hasBio ? 25 : 0) + (p.photoCount > 0 ? 25 : 0),
		steps(p.channels, [[0, 0], [5, 50]], 100),
		steps(p.dialogs, [[0, 0], [5, 60]], 100),
		steps(p.contacts, [[0, 0], [5, 60]], 100),
	])
	const cleanliness = avg([
		p.spamBlock === 'clean' ? 100 : 0,
		t.peerFloods === 0 ? 100 : 0,
		Math.max(0, 100 - t.floodWaits * 10),
		p.fingerprintChanges === 0 ? 100 : 0,
		t.reauths === 0 ? 100 : 50,
	])
	const total = endurance * 0.3 + activity * 0.3 + fullness * 0.25 + cleanliness * 0.15
	return {
		total: Math.round(total),
		endurance: Math.round(endurance),
		activity: Math.round(activity),
		fullness: Math.round(fullness),
		cleanliness: Math.round(cleanliness),
		// «Готов» только когда ВСЕ четыре выше 70: высокая выдержка при нулевой
		// активности означает, что аккаунт просто отлежался, а не прогрелся.
		ready: endurance > 70 && activity > 70 && fullness > 70 && cleanliness > 70,
	}
}

/** Советы владельцу: что именно чинить в этом аккаунте. */
function buildAdvice(i: ScoreInput, blocks: Record<BlockKey, number>, w: Warmness): Advice[] {
	const { probe: p, telemetry: t, origin: o } = i
	const out: Advice[] = []

	if (p.banned) out.push({ level: 'стоп', text: 'Аккаунт забанен. В работу не пускать, прогрев бесполезен' })
	if (p.frozen) out.push({ level: 'стоп', text: 'Аккаунт заморожен. Нужна апелляция, до неё любые действия только вредят' })
	if (p.spamBlock === 'permanent') out.push({ level: 'стоп', text: 'Вечный спамблок. Аккаунт не восстановится, замените' })
	if (!o.proxyAlive) out.push({ level: 'стоп', text: 'Прокси не отвечает. Прогрев без прокси запускать нельзя' })

	if (p.spamBlock === 'temporary') out.push({ level: 'важно', text: 'Временный спамблок. Остановите исходящие, оставьте только чтение, дайте отлежаться' })
	if (t.peerFloods > 0) out.push({ level: 'важно', text: 'Был PEER_FLOOD. Это не лимит скорости, а вердикт по поведению: снизьте исходящие вдвое' })
	if (p.fingerprintChanges > 1) out.push({ level: 'важно', text: 'Фингерпринт устройства плавает. Закрепите device_model, версию ОС и приложения за аккаунтом навсегда' })
	if (o.proxyType === 'datacenter') out.push({ level: 'важно', text: 'Датацентровый прокси палится. Переведите на мобильный или резидентный' })
	if (o.numberGeo && o.proxyGeo && o.numberGeo !== o.proxyGeo) out.push({ level: 'важно', text: `Гео не совпадает: номер ${o.numberGeo}, прокси ${o.proxyGeo}. Поставьте прокси страны номера` })
	if (o.neighborsOnIp > 3) out.push({ level: 'важно', text: `На этом IP уже ${o.neighborsOnIp} ваших аккаунтов. Они связываются между собой, разведите по разным прокси` })
	if (t.daysManaged < 1 && t.actionsTotal > 0) out.push({ level: 'важно', text: 'Аккаунт погнали в работу сразу после импорта. Дайте отлежаться минимум сутки' })
	if (t.firstDayActionShare > 0.5) out.push({ level: 'важно', text: 'Больше половины действий пришлось на первые сутки. Растяните нагрузку ровнее' })

    if (w.endurance < 70) out.push({ level: 'совет', text: `Выдержка ${w.endurance} из 100. Продолжайте прогрев, до готовности нужно 7 дней под управлением` })
	if (w.activity < 70) out.push({ level: 'совет', text: `Накопленной активности мало (${w.activity} из 100). Ориентир: 5 активных дней и 40 действий, размазанных ровно` })
	if (!p.hasUsername) out.push({ level: 'совет', text: 'Не задан username. Это дешёвый плюс к доверию' })
	if (!p.hasBio) out.push({ level: 'совет', text: 'Пустое био. Заполните на 3-4 день прогрева, не сразу после импорта' })
	if (p.photoCount === 0) out.push({ level: 'совет', text: 'Нет фото профиля. Добавьте одно, позже второе — разными днями' })
	if (!p.twoFactor) out.push({ level: 'совет', text: 'Не включена двухфакторка. Это и признак хозяйского аккаунта, и защита от угона' })
	if (p.channels < 5) out.push({ level: 'совет', text: 'Мало подписок. Чтение каналов — самое безопасное действие, наращивайте им историю' })
	// Разводим два очень разных случая, которые снаружи выглядят одинаково
	// «молодыми»: у одного нет истории вообще, у другого она есть, но чужая.
	if (p.historyMessages != null && p.historyMessages < 30 && (p.ageDays ?? 0) > 90) {
		out.push({ level: 'важно', text: 'Аккаунту не первый месяц, а переписки почти нет. Такой возраст Telegram не засчитывает — прогревайте как новый' })
	}
	if (p.historyMessages != null && p.historyMessages > 300) {
		out.push({ level: 'совет', text: `В переписках уже около ${p.historyMessages} сообщений — своя история у аккаунта есть, разгонять его можно смелее` })
	}
	if (blocks.origin < 50 && o.numberGeo) out.push({ level: 'совет', text: `Гео ${o.numberGeo} по нашим данным живёт хуже среднего. Для новых закупок берите RU, UA, KZ` })
	if (!o.supplier) out.push({ level: 'совет', text: 'Не указан поставщик. Ведите статистику выживаемости по поставщикам, это сильнейший признак' })

	return out
}

export function scoreAccount(i: ScoreInput): ScoreResult {
	const t = i.telemetry
	// У свежего аккаунта нет истории поведения, блокировок и восстановлений.
	// Такие блоки НЕ дают сто баллов «за отсутствие проблем»: иначе мусорный
	// аккаунт нулевого возраста получал средний скор просто потому, что не успел
	// ничего испортить. Блок без данных исключается из взвешенного среднего,
	// и итог считается только по тому, что мы действительно знаем.
	const hasHistory = t.daysManaged > 0 || t.actionsTotal > 0
	const raws: Record<BlockKey, Block> = {
		age: { value: blockAge(i.probe, t), hasData: true },
		identity: { value: blockIdentity(i.probe), hasData: true },
		network: { value: blockNetwork(i.origin), hasData: true },
		behavior: { value: blockBehavior(i.probe, t), hasData: hasHistory || i.probe.dialogs + i.probe.channels + i.probe.contacts > 0 },
		restrictions: { value: blockRestrictions(i.probe, t), hasData: i.probe.spamBlock !== 'unknown' && hasHistory },
		recovery: { value: blockRecovery(t), hasData: hasHistory },
		origin: { value: blockOrigin(i.origin), hasData: true },
	}
	const blocks = Object.fromEntries(
		(Object.keys(raws) as BlockKey[]).map(k => [k, raws[k].value]),
	) as Record<BlockKey, number>
	const noData = (Object.keys(raws) as BlockKey[]).filter(k => !raws[k].hasData)

	const used = (Object.keys(WEIGHTS) as BlockKey[]).filter(k => raws[k].hasData)
	const weightSum = used.reduce((s, k) => s + WEIGHTS[k], 0) || 1
	const raw = used.reduce((s, k) => s + raws[k].value * WEIGHTS[k], 0) / weightSum

	// Вето сильнее любой суммы баллов: мёртвый аккаунт не бывает «средним».
	// В вето попадает только то, что неотделимо от самого аккаунта.
	let veto: string | null = null
	if (i.probe.banned) veto = 'аккаунт забанен'
	else if (i.probe.frozen) veto = 'аккаунт заморожен'
	else if (i.probe.spamBlock === 'permanent') veto = 'вечный спамблок'

	// Мёртвый прокси в вето НЕ входит, хотя в разобранном аналоге входит.
	// Причина: прокси — сменная деталь. Обнулять до 1.0 аккаунт, который
	// год отлёживался и две недели грелся, из-за отвалившегося канала —
	// значит потерять единственный признак, по которому его выбирают из пула.
	// Работать он сейчас всё равно не может, и об этом говорит blocked.
	const blocked = !i.origin.proxyAlive ? 'прокси не отвечает' : null

	const score = veto ? 1 : Math.round((1 + 9 * (raw / 100)) * 10) / 10
	const w = warmness(i.probe, i.telemetry)

	return {
		score,
		category: score < 4 ? 'низкий' : score < 7 ? 'средний' : score < 8.5 ? 'хороший' : 'высокий',
		blocks,
		noData,
		veto,
		blocked,
		warmness: w,
		advice: buildAdvice(i, blocks, w),
	}
}
