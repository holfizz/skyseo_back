/**
 * Демо-данные для разделов «Прогрев ТГ» и «Рассылка ТГ». ТОЛЬКО ДЕВ.
 *
 * Запуск: npm run seed:tg-demo
 *
 * Зачем. Оба раздела почти нечем смотреть: на пустом пуле не видно ни одного
 * состояния, ради которых интерфейс и делался — мёртвый прокси, спамблок,
 * аккаунт в режиме «только грев», очередь на три дня, переписка с ответом.
 * Сид расставляет ровно эти случаи, по одному на каждый, чтобы страницу можно
 * было проверить глазами, а не воображением.
 *
 * Безопасность. Сессии у аккаунтов выдуманные — подключиться ими нельзя, и это
 * намеренно: демо-аккаунт не должен уметь никому написать. Юзернеймы адресатов
 * начинаются с zz_demo_ и в Telegram не существуют. Сид отказывается работать
 * с любой базой, кроме локальной.
 *
 * Идемпотентность. Своё помечено префиксами «ДЕМО · » (аккаунты, кампании) и
 * zz_demo_ / demo-*.ru (адресаты, лиды, прокси) и удаляется при повторном
 * запуске. Чужие данные не трогаются.
 */
import { PrismaClient } from '@prisma/client'
import { FIRST_MESSAGE, SECOND_MESSAGE } from '../src/tg-warmup/campaign-preset'
import { planDay } from '../src/tg-warmup/warmup-plan'

const prisma = new PrismaClient()

const MARK = 'ДЕМО · '
const DAY = 86400000
const now = new Date()

/** Детерминированный генератор: одинаковый сид — одинаковая картинка. */
let seed = 20260904
const rnd = () => {
	seed = (seed * 1103515245 + 12345) % 2147483648
	return seed / 2147483648
}
const pick = <T,>(list: T[]): T => list[Math.floor(rnd() * list.length)]
const between = (a: number, b: number) => Math.floor(a + rnd() * (b - a + 1))
const ago = (days: number, hour = 12, min = 0) => {
	const d = new Date(now.getTime() - days * DAY)
	d.setHours(hour, min, 0, 0)
	return d
}
const atToday = (hour: number, min: number) => {
	const d = new Date(now)
	d.setHours(hour, min, 0, 0)
	return d
}

// ── аккаунты ─────────────────────────────────────────────────────────────────

/** Анкета аккаунта: то, что приходит из probeAccount и питает оценку. */
function probe(o: {
	ageDays: number; dialogs: number; channels: number; contacts: number
	filled: number; premium?: boolean; spam?: string; sessions?: number
	history?: number; oldestDialog?: number
}) {
	return {
		ageDays: o.ageDays,
		oldestSessionDays: Math.min(o.ageDays, between(20, 200)),
		hasFirstName: o.filled >= 1, hasLastName: o.filled >= 4,
		hasUsername: o.filled >= 2, hasBio: o.filled >= 3,
		photoCount: o.filled >= 5 ? 2 : o.filled >= 2 ? 1 : 0,
		activeSessions: o.sessions ?? 1,
		premium: !!o.premium,
		twoFactor: o.filled >= 4,
		dialogs: o.dialogs, channels: o.channels, contacts: o.contacts,
		historyMessages: o.history ?? null,
		oldestDialogDays: o.oldestDialog ?? null,
		outgoingTotal: 0,
		spamBlock: o.spam ?? 'clean',
		frozen: false, banned: false, fingerprintChanges: 0,
	}
}

const DEVICES = [
	['iPhone 14', 'iOS 17.4', '10.9.2'],
	['Samsung SM-G991B', 'Android 13', '10.8.1'],
	['iPhone 12 mini', 'iOS 16.7', '10.9.0'],
	['Xiaomi 2201123G', 'Android 12', '10.7.4'],
]

type Spec = {
	label: string; phone: string; username?: string; first: string; last?: string
	status: 'NEW' | 'READY' | 'WARMING' | 'PAUSED' | 'BANNED' | 'ERROR'
	mode: 'WARM' | 'SEND' | 'BOTH'
	proxy: number | null
	score: number | null; warmness: number | null
	actions: number; warmDays: number; floods: number; peerFloods: number
	force?: boolean
	lastError?: string
	p: Parameters<typeof probe>[0]
	/** Прогрев: сколько дней всего, какой день идёт, темп. */
	run?: { days: number; dayIndex: number; pace: 'calm' | 'normal' | 'fast' }
	events?: Array<{ kind: string; text: string; daysAgo: number }>
}

const SPECS: Spec[] = [
	{
		label: MARK + 'Рабочая лошадка', phone: '+79261110011', username: 'demo_maria_k',
		first: 'Мария', last: 'Кузнецова', status: 'READY', mode: 'BOTH', proxy: 0,
		score: 9.1, warmness: 88, actions: 340, warmDays: 14, floods: 0, peerFloods: 0,
		p: { ageDays: 690, dialogs: 34, channels: 21, contacts: 47, filled: 5, premium: true, history: 1840, oldestDialog: 610 },
	},
	{
		label: MARK + 'Греется, 3-й день', phone: '+79261110022', username: 'demo_pavel_r',
		first: 'Павел', status: 'WARMING', mode: 'BOTH', proxy: 1,
		score: 7.4, warmness: 52, actions: 68, warmDays: 3, floods: 1, peerFloods: 0,
		p: { ageDays: 210, dialogs: 11, channels: 9, contacts: 12, filled: 4, history: 260, oldestDialog: 180 },
		run: { days: 7, dayIndex: 3, pace: 'normal' },
	},
	{
		label: MARK + 'Греется интенсивно', phone: '+79261110033',
		first: 'Артём', status: 'WARMING', mode: 'WARM', proxy: 2,
		score: 6.8, warmness: 34, actions: 41, warmDays: 2, floods: 0, peerFloods: 0,
		p: { ageDays: 95, dialogs: 6, channels: 5, contacts: 4, filled: 3, history: 70, oldestDialog: 80 },
		run: { days: 7, dayIndex: 2, pace: 'fast' },
	},
	{
		label: MARK + 'Дорос до рассылки', phone: '+79261110044', username: 'demo_olga_v',
		first: 'Ольга', last: 'Верещагина', status: 'WARMING', mode: 'WARM', proxy: 3,
		score: 8.4, warmness: 74, actions: 190, warmDays: 9, floods: 0, peerFloods: 0,
		p: { ageDays: 430, dialogs: 22, channels: 16, contacts: 31, filled: 5, history: 940, oldestDialog: 390 },
		run: { days: 14, dayIndex: 9, pace: 'normal' },
	},
	{
		label: MARK + 'Прокси не отвечает', phone: '+79261110055',
		first: 'Сергей', status: 'READY', mode: 'BOTH', proxy: 5,
		score: 7.7, warmness: 61, actions: 120, warmDays: 6, floods: 0, peerFloods: 0,
		lastError: 'Proxy connection timed out',
		p: { ageDays: 300, dialogs: 15, channels: 12, contacts: 18, filled: 4, history: 420, oldestDialog: 250 },
	},
	{
		label: MARK + 'Без прокси', phone: '+79261110066',
		first: 'Никита', status: 'NEW', mode: 'BOTH', proxy: null,
		score: null, warmness: null, actions: 0, warmDays: 0, floods: 0, peerFloods: 0,
		p: { ageDays: 12, dialogs: 1, channels: 0, contacts: 0, filled: 1 },
	},
	{
		label: MARK + 'Временный спамблок', phone: '+79261110077', username: 'demo_denis_s',
		first: 'Денис', status: 'READY', mode: 'BOTH', proxy: 0,
		score: 5.2, warmness: 58, actions: 150, warmDays: 8, floods: 3, peerFloods: 1,
		p: { ageDays: 260, dialogs: 18, channels: 11, contacts: 20, filled: 4, spam: 'temporary', history: 380, oldestDialog: 220 },
		events: [
			{ kind: 'peer-flood', text: 'PEER_FLOOD при отправке холодного сообщения', daysAgo: 2 },
			{ kind: 'spam-check', text: 'Спросили @SpamBot: временное ограничение до 11.09', daysAgo: 1 },
		],
	},
	{
		label: MARK + 'Рассылает без прогрева', phone: '+79261110088',
		first: 'Илья', status: 'READY', mode: 'SEND', proxy: 1, force: true,
		score: 6.1, warmness: 22, actions: 14, warmDays: 1, floods: 0, peerFloods: 0,
		p: { ageDays: 40, dialogs: 3, channels: 2, contacts: 2, filled: 2, history: 25, oldestDialog: 30 },
	},
	{
		label: MARK + 'Отключён вручную', phone: '+79261110099',
		first: 'Тимур', status: 'PAUSED', mode: 'BOTH', proxy: 4,
		score: 7.0, warmness: 45, actions: 80, warmDays: 4, floods: 0, peerFloods: 0,
		p: { ageDays: 150, dialogs: 9, channels: 7, contacts: 8, filled: 3, history: 140, oldestDialog: 120 },
	},
	{
		label: MARK + 'Забанен', phone: '+79261110100',
		first: 'Роман', status: 'BANNED', mode: 'BOTH', proxy: 4,
		score: 1.0, warmness: 30, actions: 55, warmDays: 3, floods: 2, peerFloods: 2,
		lastError: 'AUTH_KEY_UNREGISTERED',
		p: { ageDays: 70, dialogs: 5, channels: 4, contacts: 3, filled: 2, spam: 'permanent' },
		events: [{ kind: 'banned', text: 'Аккаунт заблокирован Telegram при подключении', daysAgo: 3 }],
	},
]

const PROXIES = [
	{ host: '10.20.30.11', port: 1080, type: 'mobile', geo: 'RU', alive: true, note: 'демо' },
	{ host: '10.20.30.12', port: 1080, type: 'mobile', geo: 'RU', alive: true, note: 'демо' },
	{ host: '10.20.30.13', port: 1080, type: 'residential', geo: 'RU', alive: true, note: 'демо' },
	{ host: '10.20.30.14', port: 1080, type: 'residential', geo: 'RU', alive: true, note: 'демо' },
	{ host: '10.20.30.15', port: 1080, type: 'datacenter', geo: 'DE', alive: true, note: 'демо' },
	{ host: '10.20.30.16', port: 1080, type: 'mobile', geo: 'RU', alive: false, note: 'демо' },
]

// ── адресаты ────────────────────────────────────────────────────────────────

const PEOPLE: Array<[string, string, string, string, string]> = [
	// имя, отчество, фамилия, компания, домен
	['Андрей', 'Викторович', 'Селезнёв', 'ООО «Мебель Групп»', 'demo-mebel-grupp.ru'],
	['Оксана', 'Игоревна', 'Панова', 'ИП Панова', 'demo-kuhni-panova.ru'],
	['Владимир', 'Петрович', 'Ефимов', 'ООО «СтройДвор»', 'demo-stroydvor.ru'],
	['Екатерина', 'Сергеевна', 'Лаврова', 'Шкафы на заказ', 'demo-shkafy-lavrova.ru'],
	['Максим', 'Олегович', 'Гущин', 'ООО «Печи Плюс»', 'demo-pechi-plus.ru'],
	['Наталья', 'Андреевна', 'Кузьмина', 'Двери Оптом', 'demo-dveri-optom.ru'],
	['Игорь', 'Валерьевич', 'Хромов', 'ООО «Лестницы Мастер»', 'demo-lestnicy-master.ru'],
	['Светлана', 'Юрьевна', 'Белова', 'Текстиль Дом', 'demo-tekstil-dom.ru'],
	['Дмитрий', 'Николаевич', 'Зорин', 'ООО «Заборы 24»', 'demo-zabory24.ru'],
	['Алина', 'Романовна', 'Крылова', 'Ковры и паласы', 'demo-kovry-krylova.ru'],
	['Юрий', 'Максимович', 'Астахов', 'ООО «Окна Плюс»', 'demo-okna-plus.ru'],
	['Полина', 'Дмитриевна', 'Ершова', 'Студия ремонта', 'demo-remont-ershova.ru'],
	['Константин', 'Львович', 'Дьяков', 'ООО «Бани Строй»', 'demo-bani-stroy.ru'],
	['Марина', 'Олеговна', 'Тихонова', 'Мягкая мебель', 'demo-myagkaya-mebel.ru'],
	['Артур', 'Ринатович', 'Сафин', 'ООО «Кровля Про»', 'demo-krovlya-pro.ru'],
	['Вера', 'Ивановна', 'Гончарова', 'Плитка и керамика', 'demo-plitka-goncharova.ru'],
	['Егор', 'Станиславович', 'Мальцев', 'ООО «Сад и Огород»', 'demo-sad-ogorod.ru'],
	['Лариса', 'Петровна', 'Носова', 'Шторы на заказ', 'demo-shtory-nosova.ru'],
	['Валентин', 'Аркадьевич', 'Шилов', 'ООО «Металлопрокат»', 'demo-metalloprokat.ru'],
	['Жанна', 'Викторовна', 'Соловьёва', 'Детская мебель', 'demo-detskaya-mebel.ru'],
	['Руслан', 'Тимурович', 'Бекетов', 'ООО «Автозапчасти»', 'demo-avtozapchasti.ru'],
	['Ирина', 'Алексеевна', 'Фомина', 'Салон красоты', 'demo-salon-fomina.ru'],
	['Григорий', 'Павлович', 'Лапшин', 'ООО «Логистика Юг»', 'demo-logistika-ug.ru'],
	['Анжела', 'Борисовна', 'Титова', 'Цветы оптом', 'demo-cvety-titova.ru'],
	['Виктор', 'Семёнович', 'Ковалёв', 'ООО «Насосы и Трубы»', 'demo-nasosy-truby.ru'],
	['Кристина', 'Денисовна', 'Гуляева', 'Свет и люстры', 'demo-svet-gulyaeva.ru'],
	['Леонид', 'Ефимович', 'Прокофьев', 'ООО «Тепличный»', 'demo-teplichny.ru'],
	['Тамара', 'Григорьевна', 'Вавилова', 'Обои и декор', 'demo-oboi-vavilova.ru'],
	['Станислав', 'Юрьевич', 'Дёмин', 'ООО «Инструмент»', 'demo-instrument-demin.ru'],
	['Алла', 'Витальевна', 'Жукова', 'Кухни на заказ', 'demo-kuhni-zhukova.ru'],
	['Тимофей', 'Аркадьевич', 'Рубцов', 'ООО «Ворота Авто»', 'demo-vorota-avto.ru'],
	['Елизавета', 'Кирилловна', 'Медведева', 'Матрасы и сон', 'demo-matrasy-med.ru'],
	['Борис', 'Игнатьевич', 'Панкратов', 'ООО «Спецодежда»', 'demo-specodezhda.ru'],
	['Ульяна', 'Марковна', 'Дроздова', 'Посуда и сервировка', 'demo-posuda-drozd.ru'],
	['Захар', 'Ильич', 'Одинцов', 'ООО «Бытовая техника»', 'demo-byt-tehnika.ru'],
	['Нина', 'Фёдоровна', 'Симонова', 'Товары для дачи', 'demo-dacha-simonova.ru'],
]

const handle = (i: number) => 'zz_demo_' + String(i + 1).padStart(2, '0')

/** Живые ответы на первое касание — разные по настроению. */
const REPLIES = [
	'Здравствуйте! Да, интересно, пришлите отчёт',
	'Добрый день. А сколько это стоит примерно?',
	'Спасибо, но мы уже работаем с подрядчиком',
	'Присылайте, посмотрю на выходных',
	'А вы по Москве работаете или по всей России?',
	'Не интересует, спасибо',
]

async function wipe() {
	// Кампании — по префиксу; адресаты и сообщения уйдут каскадом.
	const camps = await prisma.tgCampaign.findMany({ where: { name: { startsWith: MARK } }, select: { id: true } })
	if (camps.length) await prisma.tgCampaign.deleteMany({ where: { id: { in: camps.map(c => c.id) } } })
	// Адресаты сида могли осесть и в чужих кампаниях — убираем по юзернейму.
	await prisma.tgRecipient.deleteMany({ where: { username: { startsWith: 'zz_demo_' } } })
	await prisma.outreachLead.deleteMany({ where: { domain: { startsWith: 'demo-' } } })
	// Аккаунты — по префиксу; прогоны, действия, события уйдут каскадом.
	await prisma.tgAccount.deleteMany({ where: { label: { startsWith: MARK } } })
	await prisma.tgProxy.deleteMany({ where: { note: 'демо' } })
	console.log('Прошлые демо-данные убраны')
}

async function main() {
	if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) {
		console.error('[ОТКАЗ] Сид только для локальной базы. DATABASE_URL указывает не на localhost.')
		process.exit(1)
	}

	await wipe()

	// ── прокси ──
	const proxies = []
	for (const p of PROXIES) {
		proxies.push(await prisma.tgProxy.create({
			data: { ...p, kind: 'socks5', lastCheckAt: ago(0, 9, 30), lastError: p.alive ? null : 'connect ETIMEDOUT' },
		}))
	}
	console.log(`Прокси: ${proxies.length} (живых ${proxies.filter(p => p.alive).length})`)

	// ── аккаунты ──
	const accounts = []
	for (let i = 0; i < SPECS.length; i++) {
		const s = SPECS[i]
		const [device, os, app] = DEVICES[i % DEVICES.length]
		const a = await prisma.tgAccount.create({
			data: {
				label: s.label, phone: s.phone, username: s.username ?? null,
				firstName: s.first, lastName: s.last ?? null,
				tgUserId: String(700000000 + i * 137),
				// Сессия выдуманная: подключиться демо-аккаунтом нельзя, и это намеренно.
				session: 'ДЕМО-СЕССИЯ-НЕ-РАБОТАЕТ',
				apiId: 39413590, apiHash: 'demo'.repeat(8),
				deviceModel: device, systemVersion: os, appVersion: app,
				langCode: 'ru', systemLangCode: 'ru',
				proxyId: s.proxy == null ? null : proxies[s.proxy].id,
				status: s.status, mode: s.mode, forceSend: !!s.force,
				score: s.score, warmness: s.warmness,
				scoredAt: s.score == null ? null : ago(between(0, 2), 11, 20),
				probe: s.score == null ? undefined : (probe(s.p) as any),
				registeredAt: new Date(now.getTime() - s.p.ageDays * DAY),
				actionsTotal: s.actions, warmupDaysDone: s.warmDays,
				floodWaits: s.floods, peerFloods: s.peerFloods,
				lastCheckAt: ago(between(0, 3), 10, 5),
				lastError: s.lastError ?? null,
				createdAt: ago(Math.max(1, s.warmDays + between(1, 4)), 15, 0),
			},
		})
		accounts.push(a)

		for (const e of s.events ?? []) {
			await prisma.tgAccountEvent.create({
				data: { accountId: a.id, kind: e.kind, text: e.text, createdAt: ago(e.daysAgo, between(10, 19), between(0, 59)) },
			})
		}
	}
	console.log(`Аккаунты: ${accounts.length}`)

	// ── прогревы и журнал действий ──
	const KINDS = ['dialogs', 'channel', 'read', 'stories', 'story-view', 'search', 'profile', 'online', 'saved', 'stickers', 'join', 'reaction']
	let actionRows = 0

	for (let i = 0; i < SPECS.length; i++) {
		const s = SPECS[i]
		const a = accounts[i]

		let runId: string | null = null
		if (s.run) {
			const built = planDay({
				accountId: a.id, dayIndex: s.run.dayIndex, runIndex: s.run.days,
				ageDays: s.p.ageDays, windows: [{ fromHour: 9, toHour: 23 }], pace: s.run.pace,
			})
			const run = await prisma.tgWarmupRun.create({
				data: {
					accountId: a.id, days: s.run.days, dayIndex: s.run.dayIndex,
					status: 'RUNNING', windowFrom: 9, windowTo: 23, pace: s.run.pace,
					planDate: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
					plan: built.sessions as any,
					doneToday: Math.max(0, Math.floor(built.sessions.length * 0.4)),
					nextRunAt: atToday(between(Math.min(22, now.getHours() + 1), 22), between(0, 59)),
					startedAt: ago(s.run.dayIndex, 9, 30),
				},
			})
			runId = run.id
		}

		// Журнал: события размазаны по дням, часть неудачных — чтобы фильтр
		// «ошибки» в общей ленте было на чём проверить.
		const days = Math.min(14, Math.max(1, s.warmDays))
		let left = s.actions
		for (let d = days; d >= 1 && left > 0; d--) {
			const perDay = Math.min(left, Math.max(1, Math.round(s.actions / days + between(-3, 3))))
			for (let k = 0; k < perDay; k++) {
				const ok = rnd() > 0.08
				await prisma.tgWarmupAction.create({
					data: {
						accountId: a.id, runId, dayIndex: Math.max(1, s.warmDays - d + 1),
						kind: pick(KINDS), ok,
						detail: ok ? null : pick(['FLOOD_WAIT_32', 'прокси не ответил', 'канал недоступен']),
						createdAt: ago(d - 1, between(9, 22), between(0, 59)),
					},
				})
				actionRows++
			}
			left -= perDay
		}
	}
	console.log(`Прогревы: ${SPECS.filter(s => s.run).length}, записей в журнале: ${actionRows}`)

	// ── лиды для кнопки «Взять N и запустить» ──
	// Без пометки «дев-сид»: иначе фильтр их отсеет и кнопку нечем будет проверить.
	// Юзернеймы выдуманные, а сид работает только на локальной базе.
	let leads = 0
	for (let i = 24; i < PEOPLE.length; i++) {
		const [first, middle, last, company, domain] = PEOPLE[i]
		await prisma.outreachLead.create({
			data: {
				domain, companyName: company, firstName: first, middleName: middle, lastName: last,
				telegram: '@' + handle(i), telegramManual: true, channel: 'Telegram',
				keywordsCount: between(3, 18), bestPosition: between(11, 48), score: between(20, 90),
				message: 'демо-лид', notes: null,
				createdAt: ago(between(1, 20), between(9, 20), 0),
			},
		})
		leads++
	}
	console.log(`Лидов с телеграмом (для кнопки запуска): ${leads}`)

	// ── кампании ──
	const sender = accounts.filter(a => ['READY', 'WARMING'].includes(a.status) && a.mode !== 'WARM' && !a.lastError)
	const senderIds = sender.slice(0, 3).map(a => a.id)

	/** Одна кампания со своим набором адресатов по стадиям. */
	async function campaign(o: {
		name: string; status: 'DRAFT' | 'RUNNING' | 'PAUSED'
		sendDate: Date | null; goal: number | null
		from: number; count: number
		stages: Array<[string, number]>
	}) {
		const c = await prisma.tgCampaign.create({
			data: {
				name: MARK + o.name, status: o.status,
				firstMessage: FIRST_MESSAGE, secondMessage: SECOND_MESSAGE,
				dailyGoal: o.goal, perAccountPerDay: 20,
				minIntervalSec: 240, maxIntervalSec: 1200,
				windowFrom: 10, windowTo: 20,
				sendDate: o.sendDate,
				startedAt: o.status === 'DRAFT' ? null : ago(1, 10, 0),
				createdAt: ago(o.status === 'DRAFT' ? 0 : 2, 9, 0),
				accounts: { create: senderIds.map(accountId => ({ accountId, dailyLimit: null })) },
			},
		})

		let idx = o.from
		let planAt = atToday(10, between(5, 40))
		for (const [status, n] of o.stages) {
			for (let k = 0; k < n && idx < PEOPLE.length; k++, idx++) {
				const [first, middle, last, company, domain] = PEOPLE[idx]
				const acc = senderIds[idx % senderIds.length]
				const sentAt = status === 'QUEUED' ? null : ago(between(0, 1), between(10, 19), between(0, 59))
				const r = await prisma.tgRecipient.create({
					data: {
						campaignId: c.id, username: handle(idx), phone: null,
						firstName: first, middleName: middle, lastName: last,
						company, domain,
						status: status as any,
						accountId: status === 'QUEUED' ? null : acc,
						plannedAccountId: status === 'QUEUED' && o.status !== 'DRAFT' ? acc : null,
						scheduledAt: status === 'QUEUED' && o.status !== 'DRAFT' ? planAt : null,
						sentAt,
						sentMsgId: sentAt ? between(100, 999) : null,
						readAt: ['READ', 'REPLIED', 'SECOND_SENT'].includes(status) ? new Date(sentAt!.getTime() + between(5, 90) * 60000) : null,
						repliedAt: ['REPLIED', 'SECOND_SENT'].includes(status) ? new Date(sentAt!.getTime() + between(30, 240) * 60000) : null,
						secondSentAt: status === 'SECOND_SENT' ? new Date(sentAt!.getTime() + between(240, 400) * 60000) : null,
						blockedAt: status === 'BLOCKED' ? sentAt : null,
						error: status === 'BLOCKED' ? 'закрыты настройки приватности — писать нельзя'
							: status === 'FAILED' ? 'такого юзернейма не существует' : null,
						createdAt: ago(2, 9, between(0, 59)),
					},
				})

				if (status === 'QUEUED' && o.status !== 'DRAFT') {
					planAt = new Date(planAt.getTime() + between(5, 22) * 60000)
				}

				// Переписка: наше первое, ответ, иногда второе и продолжение.
				if (sentAt) {
					const text = FIRST_MESSAGE
						.replace('{фио}', `${first} ${middle}`)
						.replace('{ждал}', 'ждал будние, чтобы вам написать')
						.replace('{сайт}', domain.replace(/^demo-/, '').replace(/\.ru$/, ''))
					await prisma.tgDialogMessage.create({
						data: { recipientId: r.id, tgId: 1, out: true, text, date: sentAt },
					})
					if (['REPLIED', 'SECOND_SENT'].includes(status)) {
						await prisma.tgDialogMessage.create({
							data: {
								recipientId: r.id, tgId: 2, out: false, text: pick(REPLIES),
								date: new Date(sentAt.getTime() + between(30, 240) * 60000),
							},
						})
					}
					if (status === 'SECOND_SENT') {
						await prisma.tgDialogMessage.create({
							data: {
								recipientId: r.id, tgId: 3, out: true, text: SECOND_MESSAGE,
								date: new Date(sentAt.getTime() + between(250, 400) * 60000),
							},
						})
					}
				}
			}
		}

		// Счётчик отправленного за сегодня у аккаунтов кампании.
		const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
		if (o.status === 'RUNNING') {
			const links = await prisma.tgCampaignAccount.findMany({ where: { campaignId: c.id } })
			for (const l of links) {
				await prisma.tgCampaignAccount.update({
					where: { id: l.id },
					data: { dayKey: today, sentToday: between(1, 4), nextSendAt: atToday(between(Math.min(19, now.getHours()), 19), between(0, 59)) },
				})
			}
		}
		return { c, used: idx }
	}

	const running = await campaign({
		name: new Date().toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }),
		status: 'RUNNING', sendDate: atToday(0, 0), goal: 12, from: 0, count: 14,
		stages: [['SENT', 2], ['READ', 2], ['REPLIED', 2], ['SECOND_SENT', 1], ['BLOCKED', 1], ['QUEUED', 6]],
	})

	const paused = await campaign({
		name: 'Мебель · холодные',
		status: 'PAUSED', sendDate: new Date(now.getTime() - DAY), goal: null, from: running.used, count: 8,
		stages: [['SENT', 2], ['READ', 1], ['REPLIED', 1], ['FAILED', 2], ['QUEUED', 2]],
	})

	await campaign({
		name: 'Черновик на завтра',
		status: 'DRAFT', sendDate: null, goal: null, from: paused.used, count: 4,
		stages: [['QUEUED', 4]],
	})

	const counts = await prisma.tgRecipient.groupBy({ by: ['status'], _count: { _all: true }, where: { username: { startsWith: 'zz_demo_' } } })
	console.log('Кампании: 3 (идёт / на паузе / черновик)')
	console.log('Адресаты:', counts.map(c => `${c.status} ${c._count._all}`).join(' · '))
	console.log('\nГотово. Демо помечено «ДЕМО · » и zz_demo_ — повторный запуск заменит только его.')
	console.log('Сессии у демо-аккаунтов выдуманные: подключиться и написать ими нельзя.')
}

main()
	.catch(e => { console.error(e); process.exit(1) })
	.finally(() => prisma.$disconnect())
