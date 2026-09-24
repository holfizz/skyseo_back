import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { SocksClient } from 'socks'
import { PrismaService } from '../prisma/prisma.service'
import { TelegramService } from '../telegram/telegram.service'
import { decryptSecret, encryptSecret, secretsReady } from '../common/secrets'
import {
	defaultFingerprint, importFromSessionFile, importFromStringSession, importFromTdataZip,
	mergeFingerprint, parseCompanionJson, type CompanionMeta, type Fingerprint,
} from './session-import'
import { parseProxyPool } from './proxy-pool'
import { detectOrigin } from './proxy-geo'
import { Api } from 'teleproto'
import bigInt from 'big-integer'
import { call, classifyError, probeAccount, TgError, withClient, type ProxySettings } from './tg-client'
import { askStatus, parseRestrictedUntil, pressButton, sendText } from './spam-bot'
import { applyProfile, readProfile, type ProfilePatch } from './profile-edit'
import { catalogInfo, DEFAULT_CHANNELS, OUTGOING, REACTION_ACTIONS, runAction, type ActionKind } from './warmup-actions'
import {
	accountSeed, dailyStartMinute, growthCeiling, makeRng, outgoingAllowance, PACE, PACES, paceMinutes,
	planDay, throttleFor, upkeepIdle, type Allowance, type Pace, type Session, type Window,
} from './warmup-plan'
import { mskAt, mskDayKey, mskMinuteOfDay } from './msk'
import { GEO_SURVIVAL, scoreAccount, type AccountOrigin, type AccountTelemetry, type ScoreResult } from './warmup-score'
import { estimateRegistration } from './account-age'

const DAY_MS = 86400000

/** Как часто сами спрашиваем у @SpamBot, не ограничен ли аккаунт. */
const SPAM_CHECK_EVERY_DAYS = 7

/** Реакции, голоса и пересылки — быстрая проверка по виду действия. */
const REACTION_KINDS = new Set<string>(REACTION_ACTIONS)
const KEY_CHANNELS = 'tg_warmup_channels'
const KEY_API_ID = 'tg_warmup_api_id'
const KEY_API_HASH = 'tg_warmup_api_hash'
const KEY_ACTIONS = 'tg_warmup_disabled_actions'

/** Адрес дата-центра Telegram, по которому проверяется живость прокси. */
const DC_PROBE = { host: '149.154.167.51', port: 443 }

/**
 * Гео по телефонному коду. Список короткий намеренно: нужны только страны,
 * которые встречаются в блоке «Происхождение» скоринга. Порядок важен —
 * длинные коды идут первыми, иначе +7 съест всё.
 */
const PHONE_GEO: Array<[string, string]> = [
	['380', 'UA'], ['998', 'UZ'], ['992', 'TJ'], ['880', 'BD'], ['995', 'GE'],
	['90', 'TR'], ['91', 'IN'], ['62', 'ID'], ['66', 'TH'], ['95', 'MM'],
	['57', 'CO'], ['56', 'CL'], ['55', 'BR'], ['54', 'AR'], ['48', 'PL'],
	['49', 'DE'], ['44', 'GB'], ['7', 'RU'], ['1', 'US'],
]

function geoByPhone(phone?: string | null): string | null {
	const digits = String(phone ?? '').replace(/\D/g, '')
	if (!digits) return null
	for (const [code, iso] of PHONE_GEO) if (digits.startsWith(code)) return iso
	return null
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

/** Экранирование под parse_mode: HTML в боте. */
function escapeHtml(s: string): string {
	return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Как звать аккаунт: имя, иначе юзернейм, иначе телефон. */
/** Проверка правки профиля до подключения к Telegram — чтобы не тратить заход на заведомый отказ. */
function validateProfile(p: ProfilePatch): string | null {
	if (p.firstName !== undefined && !p.firstName.trim()) return 'Имя не может быть пустым'
	if (p.firstName && p.firstName.length > 64) return 'Имя длиннее 64 символов'
	if (p.lastName && p.lastName.length > 64) return 'Фамилия длиннее 64 символов'
	if (p.about && p.about.length > 140) return 'Описание длиннее 140 символов'
	if (p.username && !/^[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(p.username)) {
		return 'Юзернейм: 5–32 символа, латиница, цифры и _, начинается с буквы'
	}
	if (p.birthday) {
		const { day, month, year } = p.birthday
		if (!(month >= 1 && month <= 12)) return 'Неверный месяц рождения'
		const days = new Date(year || 2024, month, 0).getDate()
		if (!(day >= 1 && day <= days)) return 'Неверный день рождения'
		if (year && (year < 1900 || year > new Date().getFullYear())) return 'Неверный год рождения'
	}
	const heavy = (p.photos ?? []).find(x => x.buffer.length > 10 * 1024 * 1024)
	if (heavy) return `Фото «${heavy.name}» больше 10 МБ`
	if ((p.photos ?? []).length > 10) return 'За раз можно загрузить не больше десяти фото'
	return null
}

function displayName(self: { firstName?: string | null; lastName?: string | null; username?: string | null; phone?: string | null }): string | null {
	const name = [self.firstName, self.lastName].filter(Boolean).join(' ').trim()
	if (name) return name
	if (self.username) return '@' + self.username
	if (self.phone) return self.phone
	return null
}

/** Ключ дня в местной шкале сервера: планы строятся по календарным суткам. */
/** Полночь указанных суток по местному времени. */
function startOfDayLocal(d: Date): Date {
	return mskAt(d, 0, 0)
}

/** «ГГГГ-ММ-ДД» → полночь этого дня. Местная, а не UTC: день выбирают глазами. */
function parseDayLocal(value?: string | null): Date | null {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? '').trim())
	if (!m) return null
	// Полночь этого дня ПО МОСКВЕ: календарь показывает московские сутки.
	return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - 180 * 60_000)
}

/** Ключ суток по Москве: по нему считаются дневные нормы и планы. */
function dateKey(d: Date): string {
	return mskDayKey(d)
}

/**
 * Всё, что для расчёта разрешения берётся из базы. Отдельным типом, потому что
 * счётчики снимаются и на один аккаунт, и на весь список сразу, а расчёт по ним
 * обязан быть один и тот же.
 */
type AllowanceCounters = {
	/** Вступлений в журнале: подписки, о которых анкета может ещё не знать. */
	joined: number
	/** Исходящих, ушедших сегодня на рассылку: первые касания плюс вторые. */
	spentOnOutreach: number
	sent48h: number
	/** Когда именно закрывались — throttleFor смотрит на давность каждого. */
	blockedAt: Date[]
	peerFloodAt: Date | null
}


@Injectable()
export class TgWarmupService {
	private readonly logger = new Logger(TgWarmupService.name)

	constructor(
		private prisma: PrismaService,
		private telegram: TelegramService,
	) {}

	/**
	 * Занять аккаунт под одну работу.
	 *
	 * Прогрев, рассылка, опрос ответов и проверка ходят к одному и тому же
	 * аккаунту, и каждый открывает своё соединение MTProto. Два подключения с
	 * одной сессии одновременно — то, что Telegram видит и чего живой клиент
	 * не делает. Поэтому доступ к аккаунту строго по очереди.
	 *
	 * Захват атомарный: updateMany с условием «свободен или срок вышел» и
	 * проверкой количества. Срок нужен на случай, если воркер упал и не снял
	 * захват — иначе аккаунт завис бы навсегда.
	 */
	async claimAccount(accountId: string, by: string, seconds: number): Promise<boolean> {
		const now = new Date()
		const claimed = await this.prisma.tgAccount.updateMany({
			where: {
				id: accountId,
				OR: [{ busyUntil: null }, { busyUntil: { lt: now } }],
			},
			data: { busyUntil: new Date(now.getTime() + seconds * 1000), busyBy: by },
		})
		return claimed.count === 1
	}

	async releaseAccount(accountId: string): Promise<void> {
		await this.prisma.tgAccount
			.update({ where: { id: accountId }, data: { busyUntil: null, busyBy: null } })
			.catch(() => undefined)
	}

	/**
	 * Занять, сделать, отпустить. Отпускаем всегда: незанятый навсегда аккаунт
	 * хуже, чем пропущенный заход.
	 */
	async withAccount<T>(accountId: string, by: string, seconds: number, fn: () => Promise<T>): Promise<T | null> {
		if (!(await this.claimAccount(accountId, by, seconds))) return null
		try {
			return await fn()
		} finally {
			await this.releaseAccount(accountId)
		}
	}

	/** Запись в журнал аккаунта. Ничего не роняет: журнал не важнее работы. */
	async logEvent(accountId: string, kind: string, text: string) {
		try {
			await this.prisma.tgAccountEvent.create({ data: { accountId, kind, text: text.slice(0, 4000) } })
		} catch (e: any) {
			this.logger.warn(`Событие не записалось: ${e?.message ?? e}`)
		}
	}

	private async notifyAdmin(html: string) {
		try {
			await this.telegram.sendAdminNotification(html)
		} catch (e: any) {
			this.logger.warn(`Уведомление админу не ушло: ${e?.message ?? e}`)
		}
	}

	// ── прокси ───────────────────────────────────────────────────────────────

	async listProxies() {
		const rows = await this.prisma.tgProxy.findMany({
			orderBy: { createdAt: 'desc' },
			include: { _count: { select: { accounts: true } } },
		})
		return rows.map(p => ({
			id: p.id, host: p.host, port: p.port, username: p.username,
			kind: p.kind, type: p.type, geo: p.geo, note: p.note,
			alive: p.alive, lastCheckAt: p.lastCheckAt, lastError: p.lastError,
			accounts: p._count.accounts,
		}))
	}

	/**
	 * Вставка пула одним текстом. Что не разобралось — возвращаем построчно с
	 * причиной: молча проглотить половину списка хуже, чем не принять его вовсе.
	 */
	async addProxies(text: string) {
		const { proxies, rejected } = parseProxyPool(text ?? '')
		if (!proxies.length) {
			return { added: 0, duplicates: 0, rejected }
		}
		let added = 0
		let duplicates = 0
		for (const p of proxies) {
			// createMany со skipDuplicates не подошёл: нужно знать, сколько именно
			// строк уже было, чтобы показать это в интерфейсе.
			const exists = await this.prisma.tgProxy.findFirst({
				where: { host: p.host, port: p.port, username: p.username },
				select: { id: true },
			})
			if (exists) {
				duplicates++
				continue
			}
			// Тип канала и страну не спрашиваем: их определит проверка, сходив
			// через сам прокси. Введённое руками всё равно было бы пересказом
			// того, что написал продавец.
			await this.prisma.tgProxy.create({ data: { ...p, alive: true } })
			added++
		}
		return { added, duplicates, rejected }
	}

	async deleteProxy(id: string) {
		await this.prisma.tgProxy.delete({ where: { id } })
		return { ok: true }
	}

	/**
	 * Живость прокси. Проверяем не пингом, а тем, что реально нужно: удаётся ли
	 * через него открыть TCP до дата-центра Telegram. Прокси может прекрасно
	 * отвечать и при этом не пускать на 149.154.x.x.
	 */
	async checkProxy(id: string) {
		const p = await this.prisma.tgProxy.findUnique({ where: { id } })
		if (!p) throw new NotFoundException('Прокси не найден')

		let alive = false
		let lastError: string | null = null
		// Прокси (особенно мобильные) часто отвечают не с первой попытки: одна
		// неудача — не повод объявлять его мёртвым. Пробуем до трёх раз с короткой
		// паузой, и только если все провалились — считаем недоступным.
		for (let attempt = 1; attempt <= 3 && !alive; attempt++) {
			if (attempt > 1) await new Promise(r => setTimeout(r, 1500))
			try {
				const { socket } = await SocksClient.createConnection({
					proxy: {
						host: p.host, port: p.port,
						type: p.kind === 'socks4' ? 4 : 5,
						userId: p.username ?? undefined, password: p.password ?? undefined,
					},
					command: 'connect',
					destination: DC_PROBE,
					timeout: 12_000,
				})
				socket.destroy()
				alive = true
			} catch (e: any) {
				lastError = String(e?.message ?? e).slice(0, 300)
			}
		}

		// Страну и тип канала выясняем сами, запросом ЧЕРЕЗ прокси. У мобильных
		// адрес входа и адрес выхода разные, а значение имеет именно выход —
		// его и видит Telegram. Не определилось — оставляем прежнее, а не
		// затираем: разовый сбой справочника не должен обнулять разметку.
		let origin = { ip: null as string | null, geo: null as string | null, type: null as string | null, isp: null as string | null }
		if (alive) origin = await detectOrigin(p)

		await this.prisma.tgProxy.update({
			where: { id },
			data: {
				alive,
				lastError,
				lastCheckAt: new Date(),
				...(origin.geo ? { geo: origin.geo } : {}),
				...(origin.type ? { type: origin.type } : {}),
				// Владельца адреса и точку выхода держим в заметке: по ним видно,
				// что два «разных» прокси на самом деле сидят на одном канале.
				...(origin.ip ? { note: [origin.ip, origin.isp].filter(Boolean).join(' · ').slice(0, 200) } : {}),
			},
		})
		return { alive, lastError, ...origin }
	}

	/**
	 * Проверить пул. По умолчанию только те, что ещё ни разу не проверяли, —
	 * после вставки списка это ровно новые. Проверка идёт пачками: каждая
	 * занимает до двенадцати секунд на коннект плюс запрос происхождения, и
	 * полсотни прокси по очереди — это двадцать минут ожидания.
	 */
	async checkAllProxies(onlyNew = false) {
		const rows = await this.prisma.tgProxy.findMany({
			where: onlyNew ? { lastCheckAt: null } : {},
			select: { id: true },
		})
		let alive = 0
		const queue = [...rows]
		const worker = async () => {
			for (;;) {
				const r = queue.shift()
				if (!r) return
				const res = await this.checkProxy(r.id).catch(() => ({ alive: false }))
				if (res.alive) alive++
			}
		}
		await Promise.all(Array.from({ length: Math.min(6, queue.length) }, worker))
		return { checked: rows.length, alive }
	}

	/**
	 * Оживление прокси. Перепроверяем только те, что помечены мёртвыми: прокси
	 * часто отвечает не с первого раза и залипает в «не отвечает» до ручного
	 * пинга. Планировщик зовёт это периодически — живые оживают сами.
	 * Проверяем только dead, чтобы не гонять origin-запросы по всему пулу зря.
	 */
	async recheckDeadProxies() {
		const rows = await this.prisma.tgProxy.findMany({ where: { alive: false }, select: { id: true } })
		if (!rows.length) return { checked: 0, revived: 0 }
		let revived = 0
		const queue = [...rows]
		const worker = async () => {
			for (;;) {
				const r = queue.shift()
				if (!r) return
				const res = await this.checkProxy(r.id).catch(() => ({ alive: false }))
				if (res.alive) revived++
			}
		}
		await Promise.all(Array.from({ length: Math.min(6, queue.length) }, worker))
		return { checked: rows.length, revived }
	}

	/**
	 * Раздать прокси аккаунтам без прокси. Раздаём по одному на аккаунт, пока
	 * свободные есть: соседи по IP — прямой минус в оценке, и чем их меньше,
	 * тем лучше. Если прокси меньше, чем аккаунтов, лишние остаются без него,
	 * и это видно в списке, а не подменяется общим адресом.
	 */
	/**
	 * Снять прокси с перечисленных аккаунтов.
	 *
	 * Нужно при замене пула: каналы освобождают у старых аккаунтов, чтобы отдать
	 * новым. Поштучно это делается в карточке, но на десятке аккаунтов туда
	 * пришлось бы заходить десять раз.
	 *
	 * Аккаунт без прокси не работает — он пойдёт с адреса сервера, и прогрев
	 * это увидит как помеху. Так и задумано: снятие осмысленно только парой со
	 * следующей выдачей.
	 */
	async detachProxies(accountIds: string[]) {
		if (!accountIds?.length) return { detached: 0 }
		const res = await this.prisma.tgAccount.updateMany({
			where: { id: { in: accountIds }, proxyId: { not: null } },
			data: { proxyId: null },
		})
		return { detached: res.count }
	}

	async assignProxies() {
		const accounts = await this.prisma.tgAccount.findMany({
			where: { proxyId: null },
			select: { id: true },
			orderBy: { createdAt: 'asc' },
		})
		return this.assignFromPool(accounts.map(a => a.id))
	}

	/**
	 * Раздать прокси перечисленным аккаунтам — по одному на каждого, начиная с
	 * наименее загруженных.
	 *
	 * Соседи по адресу — прямой минус в оценке, поэтому раскладываем ровно, а не
	 * вешаем всех на первый попавшийся.
	 *
	 * maxPerProxy — мягкий потолок, а не запрет. Посадить аккаунт на людный
	 * канал плохо, но оставить его на мёртвом — хуже: он тогда не работает
	 * вовсе. Поэтому сверх потолка мы всё равно сажаем, но считаем такие случаи
	 * отдельно и возвращаем числом: пусть человек видит, что пул прокси надо
	 * расширять, а не гадает, почему просела оценка у всех разом.
	 *
	 * По умолчанию потолка нет — так эта раздача работала всегда, и менять её
	 * для новичков задним числом значило бы разом оставить половину пула без
	 * канала.
	 */
	async assignFromPool(accountIds: string[], opts?: { maxPerProxy?: number }) {
		if (!accountIds.length) return { assigned: 0, left: 0, crowded: 0 }

		const max = opts?.maxPerProxy ?? Infinity
		const pool = (
			await this.prisma.tgProxy.findMany({
				where: { alive: true },
				include: { _count: { select: { accounts: true } } },
				orderBy: { createdAt: 'asc' },
			})
		).map(p => ({ id: p.id, load: p._count.accounts }))

		let assigned = 0
		let crowded = 0
		for (const id of accountIds) {
			const target = pool.sort((a, b) => a.load - b.load)[0]
			if (!target) break
			if (target.load >= max) crowded++
			await this.prisma.tgAccount.update({ where: { id }, data: { proxyId: target.id } })
			target.load++
			assigned++
		}
		return { assigned, left: accountIds.length - assigned, crowded }
	}

	/**
	 * Заменить мёртвые каналы.
	 *
	 * Сначала даём прокси шанс ожить и только тем аккаунтам, у кого он так и не
	 * ответил, меняем канал: смена прокси — это смена IP у обжитого аккаунта, и
	 * делать её из-за одного неудачного пинга дороже, чем подождать проверку.
	 *
	 * Раздаёт assignFromPool — тот же расклад по наименее загруженным, что и при
	 * выдаче новичкам: соседи по адресу вредны одинаково, первый это прокси
	 * аккаунта или второй. assignProxies сюда не годится — он по построению
	 * смотрит только на аккаунты без прокси вовсе.
	 */
	async replaceDeadProxies() {
		const recheck = await this.recheckDeadProxies()

		const stranded = await this.prisma.tgAccount.findMany({
			where: { proxy: { alive: false } },
			select: { id: true, proxyId: true },
			orderBy: { createdAt: 'asc' },
		})
		// crowded нужен и здесь: форма ответа у одной ручки не должна плавать,
		// иначе на самом частом пути (мёртвых нет) поле придёт пустым.
		if (!stranded.length) return { ...recheck, moved: 0, left: 0, crowded: 0 }

		const before = new Map(stranded.map(a => [a.id, a.proxyId]))
		/*
		 * Потолок в четыре аккаунта на канал. Оценка считает соседей по адресу
		 * ступенями (см. blockNetwork в warmup-score.ts): до трёх соседей это
		 * ещё терпимо, от десяти — ноль за весь блок «Сеть».
		 *
		 * Без потолка типовая авария «лёг поставщик, из двадцати прокси живы
		 * два» пересаживала весь пул на два адреса и отвечала «всё хорошо».
		 * Аккаунты после такого связаны между собой: прикроют один — под
		 * подозрением все.
		 */
		const { left, crowded } = await this.assignFromPool(stranded.map(a => a.id), { maxPerProxy: 4 })

		// Кому что досталось, спрашиваем у базы: assignFromPool отдаёт только
		// количество, а в журнале должен стоять адрес — иначе потом не понять,
		// откуда у аккаунта взялся новый IP и когда именно он сменился.
		const after = await this.prisma.tgAccount.findMany({
			where: { id: { in: stranded.map(a => a.id) } },
			select: { id: true, proxyId: true, proxy: { select: { host: true, port: true } } },
		})
		let moved = 0
		for (const a of after) {
			if (!a.proxyId || a.proxyId === before.get(a.id)) continue
			moved++
			await this.logEvent(a.id, 'proxy-replaced', `Прокси не отвечал, выдан ${a.proxy?.host}:${a.proxy?.port}`)
		}
		// crowded наружу отдаём отдельно: «пересадили десятерых» и «пересадили
		// десятерых на один адрес» — разные новости, и вторая требует действия.
		return { ...recheck, moved, left, crowded }
	}

	// ── аккаунты ─────────────────────────────────────────────────────────────

	/**
	 * Оценки сразу для всей пачки аккаунтов.
	 *
	 * Считаем на лету, а не берём сохранённый балл: телеметрия меняется каждый
	 * день сама по себе, и в списке должно стоять то же число, что в карточке.
	 * Ради этого расчёт батчевый — на весь список уходит два лишних запроса,
	 * а не по три на каждый аккаунт.
	 */
	private async scoreMany(accounts: any[], population?: Array<{ proxyId: string | null; createdAt: Date }>): Promise<Map<string, ScoreResult>> {
		const scored = accounts.filter(a => a.probe)
		const out = new Map<string, ScoreResult>()
		if (!scored.length) return out

		const rowsByAccount = await this.actionRows(scored.map(a => a.id))
		const outgoingByAccount = await this.outgoingLifetime(scored.map(a => a.id))
		// Соседи по прокси и размер пачки считаются относительно ВСЕХ аккаунтов,
		// а не только переданных. Когда список уже загружен целиком, он и есть
		// население; для одной карточки его надо дочитать, иначе у аккаунта
		// «магически» не окажется ни соседей, ни пачки.
		const all = population ?? (await this.prisma.tgAccount.findMany({ select: { proxyId: true, createdAt: true } }))
		const byProxy = new Map<string, number>()
		for (const a of all) {
			if (a.proxyId) byProxy.set(a.proxyId, (byProxy.get(a.proxyId) ?? 0) + 1)
		}
		const created = all.map(a => a.createdAt.getTime())

		for (const a of scored) {
			const t = this.telemetryFrom(rowsByAccount.get(a.id) ?? [], a.createdAt, a, outgoingByAccount.get(a.id) ?? 0)
			const neighbors = a.proxyId ? Math.max(0, (byProxy.get(a.proxyId) ?? 1) - 1) : 0
			const batchSize = created.filter(c => Math.abs(c - a.createdAt.getTime()) <= 60_000).length
			out.set(
				a.id,
				scoreAccount({
					probe: { ...(a.probe as any), outgoingTotal: t.outgoing },
					telemetry: t.value,
					origin: this.originFrom(a, neighbors, batchSize),
				}),
			)
		}
		return out
	}

	async listAccounts() {
		const rows = await this.prisma.tgAccount.findMany({
			orderBy: { createdAt: 'desc' },
			include: {
				proxy: { select: { id: true, host: true, port: true, alive: true, type: true, geo: true } },
				runs: {
					where: { status: { in: ['SCHEDULED', 'RUNNING'] } },
					orderBy: { startedAt: 'desc' },
					take: 1,
				},
			},
		})
		const scores = await this.scoreMany(rows, rows)

		/*
		 * Сколько у аккаунта переписок и сколько из них с ответом.
		 *
		 * Одним запросом на весь список, а не по одному на строку: у пула из
		 * полусотни аккаунтов это была бы сотня лишних обращений к базе на
		 * каждое открытие страницы. Без этих чисел «есть ли с кем разговаривать»
		 * приходилось выяснять, открывая каждый аккаунт по очереди.
		 */
		const chats = await this.prisma.tgRecipient.groupBy({
			by: ['accountId'],
			where: { accountId: { not: null }, sentAt: { not: null } },
			_count: { _all: true },
		})
		const replied = await this.prisma.tgRecipient.groupBy({
			by: ['accountId'],
			where: { accountId: { not: null }, repliedAt: { not: null } },
			_count: { _all: true },
		})
		const chatsBy = new Map(chats.map(r => [r.accountId!, r._count._all]))
		const repliedBy = new Map(replied.map(r => [r.accountId!, r._count._all]))

		return rows.map(a => {
			const run = a.runs[0]
			const live = scores.get(a.id)
			// Помеха «спам-блок» рядом со статусом. Приоритет — у вердикта @SpamBot
			// (в нём есть срок снятия), а до проверки бота показываем свежий
			// PEER_FLOOD с отправки. Плашка исчезает, когда бот скажет «чисто».
			const probe = (a.probe as any) ?? {}
			const spamBadge =
				probe.spamBlock === 'permanent' ? 'вечный спамблок, заменить'
					: probe.spamBlock === 'temporary'
						? (probe.spamBlockUntil ? `флуд до ${probe.spamBlockUntil}` : 'спам-блок')
						: a.lastError?.startsWith('PEER_FLOOD') ? 'заблокирован за флуд'
							: null
			return {
				id: a.id,
				label: a.label,
				avatar: a.avatar,
				mode: a.mode,
				forceSend: a.forceSend,
				busyBy: a.busyUntil && a.busyUntil > new Date() ? a.busyBy : null,
				phone: a.phone,
				username: a.username,
				name: [a.firstName, a.lastName].filter(Boolean).join(' ') || null,
				status: a.status,
				score: live ? live.score : a.score,
				warmness: live ? live.warmness.total : a.warmness,
				// Мешает ли что-то работать прямо сейчас — спам-блок (см. spamBadge
				// выше) или, например, отвалившийся прокси. В отличие от вето, балл
				// при этом не обнуляется.
				blocked: spamBadge ?? live?.blocked ?? null,
				scoredAt: a.scoredAt,
				registeredAt: a.registeredAt,
				ageDays: a.registeredAt ? Math.floor((Date.now() - a.registeredAt.getTime()) / DAY_MS) : null,
				actionsTotal: a.actionsTotal,
				// Переписки: скольким этот аккаунт написал и сколько ответили.
				chats: chatsBy.get(a.id) ?? 0,
				chatsReplied: repliedBy.get(a.id) ?? 0,
				warmupDaysDone: a.warmupDaysDone,
				lastCheckAt: a.lastCheckAt,
				lastError: a.lastError,
				proxy: a.proxy,
				run: run
					? {
							id: run.id, kind: run.kind, days: run.days, dayIndex: run.dayIndex, status: run.status,
							nextRunAt: run.nextRunAt, doneToday: run.doneToday,
							pace: run.pace,
							paceLabel: PACE[(run.pace as Pace) ?? 'normal']?.label ?? null,
							planned: Array.isArray(run.plan) ? (run.plan as number[]).length : 0,
						}
					: null,
			}
		})
	}

	async accountCard(id: string) {
		const a = await this.prisma.tgAccount.findUnique({
			where: { id },
			include: {
				proxy: true,
				runs: { orderBy: { startedAt: 'desc' }, take: 5 },
				actions: { orderBy: { createdAt: 'desc' }, take: 60 },
			},
		})
		if (!a) throw new NotFoundException('Аккаунт не найден')

		// Оценку пересчитываем на лету из сохранённой анкеты, а не достаём
		// сохранённый балл: телеметрия меняется каждый день сама по себе, и
		// разбор по блокам должен соответствовать тому, что видно в журнале.
		// Тот же расчёт, что в списке: иначе в списке было бы одно число,
		// а в карточке другое.
		const score = (await this.scoreMany([a])).get(a.id) ?? null

		// Именно прогрев: у фона дня прогрева нет, и брать его счётчик за день
		// разгона нельзя — карточка показала бы «день 1, только чтение» готовому
		// аккаунту, который давно рассылает.
		const activeRun = a.runs.find(
			r => (r.status === 'SCHEDULED' || r.status === 'RUNNING') && r.kind === 'WARMUP',
		)
		// Сразу после запуска dayIndex ещё нулевой: первый день начнётся, когда
		// планировщик разбудит аккаунт. Для карточки это уже первый день, иначе
		// у аккаунта со статусом «Греется» было бы написано «прогрев не запущен».
		/*
		 * Норма на сегодня — ровно та, которую видят рассылка и экран здоровья.
		 * Считается при dayIndex 0: именно она утверждается раз в сутки и по ней
		 * работает отправка. Раньше карточка считала свою, с поправкой на день
		 * разгона, и один и тот же аккаунт показывал на двух экранах разные
		 * числа — а объяснить расхождение было нечем.
		 */
		const allowance = await this.allowanceFor(a, 0)
		// Отдельно — что прогрев разрешает САМОМУ СЕБЕ сегодня. В первые двое
		// суток он только читает, и это надо показать, не выдавая за норму
		// аккаунта: рассылке эти ограничения не мешают.
		const warmupAllowance = activeRun ? await this.allowanceFor(a, Math.max(1, activeRun.dayIndex)) : null
		const spent = await this.usedToday(a.id)
		// Происхождение: страна номера, тип и страна канала, соседи по IP,
		// размер закупочной пачки. Всё это уже считается для блока «Сеть» и
		// «Происхождение» в оценке — и до сих пор наружу не выходило, так что
		// объяснить балл этих блоков на экране было нечем.
		const origin = await this.originFor(a)

		return {
			// Полный разбор оценки: баллы по блокам, вето, прогретость, советы.
			breakdown: score,
			// Что аккаунту можно СЕГОДНЯ и почему именно столько.
			allowance: { ...allowance, spentJoins: spent.joins, spentMessages: spent.messages, spentReactions: spent.reactions },
			// Идущий прогрев: какой день и что он разрешает себе сегодня.
			warmup: activeRun
				? {
						runId: activeRun.id,
						dayIndex: Math.max(1, activeRun.dayIndex),
						days: activeRun.days,
						pace: activeRun.pace,
						paceLabel: PACE[(activeRun.pace as Pace) ?? 'normal']?.label ?? null,
						windowFrom: activeRun.windowFrom,
						windowTo: activeRun.windowTo,
						nextRunAt: activeRun.nextRunAt,
						allowance: warmupAllowance,
					}
				: null,
			// Откуда аккаунт: страна номера, канал выхода, соседи по IP, пачка.
			origin,
			// Выживаемость по стране номера — приор, из которого считается
			// блок «Происхождение». Без него балл блока необъясним.
			geoSurvival: origin.numberGeo ? (GEO_SURVIVAL[origin.numberGeo] ?? null) : null,
			id: a.id, label: a.label, avatar: a.avatar, mode: a.mode, phone: a.phone, username: a.username,
			firstName: a.firstName, lastName: a.lastName, tgUserId: a.tgUserId,
			status: a.status, score: a.score, warmness: a.warmness, scoredAt: a.scoredAt,
			registeredAt: a.registeredAt, probe: a.probe, advice: a.advice,
			fingerprint: {
				deviceModel: a.deviceModel, systemVersion: a.systemVersion,
				appVersion: a.appVersion, langCode: a.langCode, systemLangCode: a.systemLangCode,
			},
			apiId: a.apiId,
			telemetry: {
				actionsTotal: a.actionsTotal, warmupDaysDone: a.warmupDaysDone,
				floodWaits: a.floodWaits, peerFloods: a.peerFloods, reauths: a.reauths,
			},
			proxy: a.proxy
				? { id: a.proxy.id, host: a.proxy.host, port: a.proxy.port, alive: a.proxy.alive, type: a.proxy.type, geo: a.proxy.geo }
				: null,
			lastError: a.lastError,
			runs: a.runs,
			actions: a.actions.map(x => ({
				id: x.id, kind: x.kind, ok: x.ok, detail: x.detail, createdAt: x.createdAt, dayIndex: x.dayIndex,
			})),
		}
	}

	/**
	 * Загрузка аккаунтов. На вход — файлы как есть: .session, .zip с tdata,
	 * .json рядом с ними, либо строковые сессии текстом.
	 *
	 * json сопоставляется с сессией по имени файла: у поставщиков это всегда
	 * пара «79001234567.session» и «79001234567.json».
	 */
	async importAccounts(input: {
		files: Array<{ name: string; buffer: Buffer }>
		strings?: string
		apiId?: number
		apiHash?: string
		passcode?: string
		/**
		 * Что делать с прокси у загруженных:
		 *   pool — раздать по одному из пула (по умолчанию),
		 *   one  — посадить всех на указанный,
		 *   none — оставить без прокси, назначить потом.
		 */
		proxyMode?: 'pool' | 'one' | 'none'
		proxyId?: string | null
	}) {
		if (!secretsReady()) {
			throw new BadRequestException(
				'Не задан SECRETS_KEY — сессии Telegram нечем шифровать. Добавьте переменную и перезапустите сервис.',
			)
		}

		// Пара из настроек — последняя в очереди: json поставщика и поле формы
		// важнее, потому что относятся к конкретной пачке.
		const defaults = await this.getApiDefaults()
		const files = input.files ?? []
		// json раскладываем по базовому имени, чтобы приложить к своей сессии.
		const metaByName = new Map<string, CompanionMeta>()
		for (const f of files) {
			if (!/\.json$/i.test(f.name)) continue
			try {
				metaByName.set(f.name.replace(/\.json$/i, ''), parseCompanionJson(f.buffer.toString('utf8')))
			} catch {
				/* битый json — не повод отказываться от самой сессии */
			}
		}
		// Единственный json на всю загрузку применяем ко всем — но ТОЛЬКО в части
		// реквизитов приложения. Поставщики действительно отдают пачку с общими
		// api_id и api_hash, а вот телефон и имя в нём относятся к одному
		// аккаунту, и подставлять их соседям — значит перепутать людей.
		const one = metaByName.size === 1 ? [...metaByName.values()][0] : undefined
		const common: CompanionMeta | undefined = one
			? { apiId: one.apiId, apiHash: one.apiHash }
			: undefined

		type Pending = { session: string; meta: CompanionMeta; source: string }
		const pending: Pending[] = []
		const errors: Array<{ source: string; reason: string }> = []

		for (const f of files) {
			if (/\.json$/i.test(f.name)) continue
			const base = f.name.replace(/\.[^.]+$/, '')
			const meta = metaByName.get(base) ?? common ?? {}
			try {
				if (/\.zip$/i.test(f.name)) {
					const list = await importFromTdataZip(f.buffer, input.passcode)
					for (const a of list) {
						pending.push({
							session: a.session,
							meta: { ...meta, userId: a.userId ?? meta.userId },
							source: list.length > 1 ? `${f.name} (слот ${a.index})` : f.name,
						})
					}
				} else if (/\.session$/i.test(f.name)) {
					pending.push({ session: importFromSessionFile(f.buffer).session, meta, source: f.name })
				} else {
					// Всё остальное пробуем прочитать как строковую сессию.
					pending.push({ session: importFromStringSession(f.buffer.toString('utf8')).session, meta, source: f.name })
				}
			} catch (e: any) {
				errors.push({ source: f.name, reason: String(e?.message ?? e) })
			}
		}

		for (const [i, line] of String(input.strings ?? '').split(/\r?\n/).entries()) {
			if (!line.trim()) continue
			try {
				pending.push({ session: importFromStringSession(line).session, meta: common ?? {}, source: `строка ${i + 1}` })
			} catch (e: any) {
				errors.push({ source: `строка ${i + 1}`, reason: String(e?.message ?? e) })
			}
		}

		const created: Array<{ id: string; source: string }> = []
		const duplicates: string[] = []
		for (const p of pending) {
			const apiId = p.meta.apiId ?? input.apiId ?? defaults.apiId
			const apiHash = p.meta.apiHash ?? input.apiHash ?? defaults.apiHash
			if (!apiId || !apiHash) {
				errors.push({
					source: p.source,
					reason: 'нет api_id и api_hash: задайте пару приложения в настройках раздела либо приложите json поставщика',
				})
				continue
			}
			// Один и тот же аккаунт дважды в пуле — это две сессии одного
			// человека, они будут мешать друг другу и портить оценку.
			if (p.meta.userId) {
				const exists = await this.prisma.tgAccount.findFirst({
					where: { tgUserId: p.meta.userId },
					select: { id: true },
				})
				if (exists) {
					duplicates.push(p.source)
					continue
				}
			}

			// Фингерпринт считается от самой сессии: до вставки id ещё нет,
			// а профиль обязан быть постоянным с первой же минуты.
			const fp: Fingerprint = mergeFingerprint(defaultFingerprint(p.session.slice(0, 32)), p.meta)
			const est = p.meta.userId ? estimateRegistration(p.meta.userId) : null

			const row = await this.prisma.tgAccount.create({
				data: {
					// Имя файла в списке ни о чём не говорит. Пока аккаунт не
					// проверен, берём телефон или юзернейм из json, а для tdata
					// хотя бы числовой id — он там есть всегда. Настоящее имя
					// подставится при первой проверке.
					label: p.meta.phone ?? p.meta.username ?? (p.meta.userId ? `id ${p.meta.userId}` : p.source),
					phone: p.meta.phone ?? null,
					username: p.meta.username ?? null,
					firstName: p.meta.firstName ?? null,
					lastName: p.meta.lastName ?? null,
					tgUserId: p.meta.userId ?? null,
					session: encryptSecret(p.session),
					apiId, apiHash,
					...fp,
					// Раздача из пула идёт после вставки: чтобы делить поровну,
					// надо знать, сколько аккаунтов создалось.
					proxyId: input.proxyMode === 'one' ? input.proxyId || null : null,
					registeredAt: p.meta.registeredAt ?? (est ? est.date : null),
					status: 'NEW',
				},
				select: { id: true },
			})
			created.push({ id: row.id, source: p.source })
		}

		const ids = created.map(c => c.id)
		// Новые аккаунты по умолчанию «греются и пишут» — значит, сразу в рассылки.
		await this.joinActiveCampaigns(ids)
		const pool = input.proxyMode !== 'one' && input.proxyMode !== 'none' && ids.length
			? await this.assignFromPool(ids)
			: null

		return { created: created.length, duplicates, errors, ids, pool }
	}

	/**
	 * Режим — единственный переключатель «пишет ли аккаунт». Аккаунт, которому
	 * разрешено писать, сам попадает во все незавершённые рассылки. Раньше
	 * список аккаунтов кампании был вторым, скрытым переключателем: владелец
	 * ставил «греется и пишет», а рассылка аккаунт не видела и писала
	 * «нет аккаунтов». Обратного шага нет намеренно: отправка и так пропускает
	 * аккаунты в режиме WARM, а в привязке живёт пауза после флуда, которую
	 * нельзя терять при повторном включении.
	 */
	private async joinActiveCampaigns(accountIds: string[]) {
		if (!accountIds.length) return
		const active = await this.prisma.tgCampaign.findMany({
			where: { status: { in: ['DRAFT', 'RUNNING', 'PAUSED'] } },
			select: { id: true },
		})
		if (!active.length) return
		await this.prisma.tgCampaignAccount.createMany({
			data: active.flatMap(c => accountIds.map(accountId => ({ campaignId: c.id, accountId }))),
			skipDuplicates: true,
		})
	}

	async deleteAccount(id: string) {
		await this.prisma.tgAccount.delete({ where: { id } })
		return { ok: true }
	}

	async setProxy(accountId: string, proxyId: string | null) {
		if (proxyId) {
			const exists = await this.prisma.tgProxy.findUnique({ where: { id: proxyId }, select: { id: true } })
			if (!exists) throw new NotFoundException('Такого прокси нет')
		}
		await this.prisma.tgAccount.update({ where: { id: accountId }, data: { proxyId } })
		// Сессия остаётся прежней, меняется только маршрут — переподключение
		// произойдёт само при следующем заходе. Проверять аккаунт заново здесь
		// не станем: это сетевой вызов, а человек мог менять прокси у десятка
		// подряд и не ждать каждого.
		return { ok: true }
	}

	/**
	 * Чем аккаунту заниматься.
	 *
	 * BOTH по умолчанию: прогрев и рассылка уживаются — они ходят к аккаунту по
	 * очереди и делят один бюджет исходящих. Разделять нужно, когда аккаунт
	 * надо вывести из работы и дать ему отлежаться (WARM), либо наоборот — не
	 * тратить его норму на служебную активность (SEND).
	 */
	async setMode(id: string, mode: string) {
		const value = String(mode ?? '').toUpperCase()
		if (!['WARM', 'SEND', 'BOTH'].includes(value)) {
			throw new BadRequestException('Режим: WARM, SEND или BOTH')
		}
		const a = await this.prisma.tgAccount.findUnique({ where: { id }, select: { status: true } })
		if (!a) throw new NotFoundException('Аккаунт не найден')
		await this.prisma.tgAccount.update({ where: { id }, data: { mode: value } })
		if (value !== 'WARM') await this.joinActiveCampaigns([id])

		// Сняли с прогрева — останавливаем идущий, иначе воркер будет ходить
		// к аккаунту, которому это больше не положено.
		if (value === 'SEND') {
			await this.prisma.tgWarmupRun.updateMany({
				where: { accountId: id, status: { in: ['SCHEDULED', 'RUNNING'] } },
				data: { status: 'STOPPED', finishedAt: new Date() },
			})
		}
		return { ok: true, mode: value }
	}

	/**
	 * Пауза аккаунта. Полная: с него не рассылают и его не греют.
	 *
	 * Нужна, чтобы вывести аккаунт из-под нагрузки, не удаляя и не теряя
	 * историю. Снятие возвращает его в READY, а не в тот статус, что был:
	 * пока он стоял, всё могло измениться, и следующий шаг — проверка.
	 */
	/**
	 * Разрешить рассылку с непрогретого аккаунта.
	 *
	 * Отдельный флаг, а не «поднять лимиты»: оценка готовности остаётся честной
	 * и продолжает показывать, что аккаунт сырой. Меняется только одно — мы
	 * перестаём мешать. Дневной предел при этом задаёт кампания, а не флаг.
	 */
	async setForceSend(id: string, force: boolean) {
		const a = await this.prisma.tgAccount.update({
			where: { id },
			data: { forceSend: !!force },
			select: { id: true, label: true, forceSend: true },
		})
		await this.logEvent(id, force ? 'force-send-on' : 'force-send-off',
			force ? 'разрешена рассылка без прогрева' : 'рассылка без прогрева отключена')
		return a
	}

	async pauseAccount(id: string, paused: boolean) {
		const a = await this.prisma.tgAccount.findUnique({ where: { id }, select: { status: true } })
		if (!a) throw new NotFoundException('Аккаунт не найден')
		if (paused && (a.status === 'BANNED' || a.status === 'ERROR')) {
			throw new BadRequestException('Этот аккаунт и так не работает — пауза ничего не изменит')
		}
		if (paused) {
			// Прогревы останавливаем: иначе воркер будет ходить к аккаунту,
			// который просили не трогать.
			await this.prisma.tgWarmupRun.updateMany({
				where: { accountId: id, status: { in: ['SCHEDULED', 'RUNNING'] } },
				data: { status: 'STOPPED', finishedAt: new Date() },
			})
		}
		await this.prisma.tgAccount.update({ where: { id }, data: { status: paused ? 'PAUSED' : 'READY' } })
		return { ok: true, status: paused ? 'PAUSED' : 'READY' }
	}

	// ── подключение ──────────────────────────────────────────────────────────

	/** Собрать параметры клиента из строки базы. Публичный: им пользуется рассылка. */
	clientOptions(a: any) {
		const proxy: ProxySettings | null = a.proxy
			? {
					host: a.proxy.host, port: a.proxy.port,
					username: a.proxy.username, password: a.proxy.password, kind: a.proxy.kind,
				}
			: null
		return {
			session: decryptSecret(a.session),
			apiId: a.apiId,
			apiHash: a.apiHash,
			fingerprint: {
				deviceModel: a.deviceModel, systemVersion: a.systemVersion,
				appVersion: a.appVersion, langCode: a.langCode, systemLangCode: a.systemLangCode,
			},
			proxy,
		}
	}

	/**
	 * Записать последствия ошибки. Разные причины требуют разного: мёртвая
	 * сессия — это конец аккаунта, а FLOOD_WAIT — просто «приходите позже».
	 */
	async applyFailure(accountId: string, failure: ReturnType<typeof classifyError>) {
		const before = await this.prisma.tgAccount.findUnique({
			where: { id: accountId },
			select: { status: true, label: true },
		})

		const patch: any = { lastError: failure.message.slice(0, 500), lastCheckAt: new Date() }
		if (failure.kind === 'banned' || failure.kind === 'frozen') patch.status = 'BANNED'
		else if (failure.kind === 'unauthorized') patch.status = 'ERROR'
		if (failure.kind === 'flood') patch.floodWaits = { increment: 1 }
		if (failure.kind === 'peerFlood') {
			patch.peerFloods = { increment: 1 }
			// Стабильный, узнаваемый текст: по нему список рисует помеху
			// «заблокирован за флуд». Сырое сообщение Telegram при PEER_FLOOD
			// это чаще всего просто «PEER_FLOOD» и ни о чём не говорит. Полную
			// строку ошибки при этом не теряем — она уходит в журнал ниже.
			patch.lastError = 'PEER_FLOOD — спам-лимит, аккаунт не пишет новым людям'
			// Через сутки планировщик сам напишет @SpamBot и обжалует (autoSpamAppeals).
			patch.spamRetryAt = new Date(Date.now() + 24 * 3600_000)
		}
		await this.prisma.tgAccount.update({ where: { id: accountId }, data: patch })

		// О смерти аккаунта сообщаем сразу и один раз: он мог быть куплен, мог
		// греться неделями, и узнать об этом из списка через сутки — поздно.
		// Условие на СМЕНУ статуса обязательно: воркер приходит каждую минуту,
		// и без него в бот сыпалось бы одно и то же до бесконечности.
		const died = patch.status && patch.status !== before?.status
		if (died) {
			const what =
				failure.kind === 'banned' ? 'заблокирован или удалён'
					: failure.kind === 'frozen' ? 'заморожен'
						: 'разлогинен — сессия больше не действует'
			await this.logEvent(
				accountId,
				failure.kind === 'unauthorized' ? 'unauthorized' : 'banned',
				`${what}: ${failure.message}`,
			)
			await this.notifyAdmin(
				`🚫 <b>Аккаунт ${escapeHtml(what)}</b>\n\n` +
					`<b>${escapeHtml(before?.label ?? accountId)}</b>\n` +
					`<code>${escapeHtml(failure.message.slice(0, 300))}</code>\n\n` +
					`Рассылка и прогрев с него остановлены.`,
			)
		}
		if (failure.kind === 'peerFlood') {
			await this.logEvent(accountId, 'peer-flood', failure.message)
			// Рейтинг обязан упасть сразу, а не после следующей ручной проверки:
			// PEER_FLOOD — поведенческий вердикт, и в карточке он должен быть виден
			// тут же. Список считает балл на лету из счётчика, а карточка берёт
			// сохранённый — пересчитываем и сохраняем, чтобы они не расходились.
			const fresh = await this.prisma.tgAccount.findUnique({ where: { id: accountId }, include: { proxy: true } })
			const scored = fresh?.probe ? (await this.scoreMany([fresh])).get(accountId) : null
			if (scored) {
				await this.prisma.tgAccount.update({
					where: { id: accountId },
					data: { score: scored.score, warmness: scored.warmness.total, advice: scored.advice as any, scoredAt: new Date() },
				})
			}
		}

		// Мёртвый прокси — не то же самое, что мёртвый аккаунт. Помечаем негодным
		// именно прокси (иначе на него повесятся следующие аккаунты), а статус
		// аккаунта не трогаем: он ни в чём не виноват и оживёт со сменой канала.
		if (failure.kind === 'proxy') {
			const acc = await this.prisma.tgAccount.findUnique({ where: { id: accountId }, select: { proxyId: true } })
			if (acc?.proxyId) {
				await this.prisma.tgProxy.update({
					where: { id: acc.proxyId },
					data: { alive: false, lastError: failure.message.slice(0, 300), lastCheckAt: new Date() },
				})
			}
		}
	}

	/** Сохранить сессию, если Telegram переселил аккаунт в другой дата-центр. */
	async persistSession(accountId: string, before: string, after: string) {
		if (after && after !== before) {
			await this.prisma.tgAccount.update({
				where: { id: accountId },
				data: { session: encryptSecret(after) },
			})
		}
	}

	// ── проверка и оценка ────────────────────────────────────────────────────

	/**
	 * Подключиться, снять анкету, посчитать оценку и сохранить.
	 *
	 * Это же единственный способ узнать, живой ли аккаунт вообще: строка сессии
	 * сама по себе ничего не гарантирует — её могли отозвать через час после
	 * продажи.
	 */
	async checkAccount(id: string): Promise<{ ok: boolean; score?: ScoreResult; error?: string }> {
		const a = await this.prisma.tgAccount.findUnique({ where: { id }, include: { proxy: true } })
		if (!a) throw new NotFoundException('Аккаунт не найден')

		if (!(await this.claimAccount(a.id, 'check', 120))) {
			return { ok: false, error: 'аккаунт сейчас занят прогревом или рассылкой, попробуйте через минуту' }
		}
		const opts = this.clientOptions(a)
		try {
			const { result, session } = await withClient(opts, c => probeAccount(c))
			await this.persistSession(a.id, opts.session, session)

			const telemetry = await this.telemetryFor(a.id, a.createdAt)
			const probe = {
				...result.probe,
				outgoingTotal: telemetry.outgoing,
				// Значение спамблока живёт между проверками: узнать его можно
				// только отдельной ручной проверкой, и терять её незачем. Вместе с
				// ним храним и срок снятия, который назвал @SpamBot.
				spamBlock: ((a.probe as any)?.spamBlock ?? 'unknown') as any,
				spamBlockUntil: ((a.probe as any)?.spamBlockUntil ?? null) as any,
			}
			const origin = await this.originFor(a)
			const score = scoreAccount({ probe, telemetry: telemetry.value, origin })

			await this.prisma.tgAccount.update({
				where: { id: a.id },
				data: {
					status: a.status === 'WARMING' ? 'WARMING' : 'READY',
					// Имя аккаунта после проверки известно точно — заменяем им
					// технический ярлык вида «id 256872712» или имя файла.
					label: displayName(result.self) ?? a.label,
					avatar: result.avatar ?? a.avatar,
					username: result.self.username ?? a.username,
					firstName: result.self.firstName ?? a.firstName,
					lastName: result.self.lastName ?? a.lastName,
					phone: result.self.phone ?? a.phone,
					tgUserId: result.self.userId || a.tgUserId,
					registeredAt: result.registeredAt ?? a.registeredAt,
					probe: probe as any,
					advice: score.advice as any,
					score: score.score,
					warmness: score.warmness.total,
					scoredAt: new Date(),
					lastCheckAt: new Date(),
					lastError: null,
				},
			})
			return { ok: true, score }
		} catch (e: any) {
			const failure = e instanceof TgError ? e.failure : classifyError(e)
			await this.applyFailure(a.id, failure)
			return { ok: false, error: failure.message }
		} finally {
			await this.releaseAccount(a.id)
		}
	}

	/**
	 * Телеметрия из нашего собственного журнала.
	 *
	 * Telegram не отдаёт ни счётчика исходящих, ни истории активности, поэтому
	 * блоки «Поведение» и «Восстановление» считаются по тому, что мы видели
	 * сами. У только что залитого аккаунта их нет — и это правильно: скоринг
	 * такие блоки исключает, а не ставит им сто баллов за отсутствие проблем.
	 */
	private async telemetryFor(accountId: string, createdAt: Date) {
		const rowsByAccount = await this.actionRows([accountId])
		const acc = await this.prisma.tgAccount.findUnique({
			where: { id: accountId },
			select: { actionsTotal: true, warmupDaysDone: true, floodWaits: true, peerFloods: true, reauths: true },
		})
		const outgoing = await this.outgoingLifetime([accountId])
		return this.telemetryFrom(rowsByAccount.get(accountId) ?? [], createdAt, acc, outgoing.get(accountId) ?? 0)
	}

	/**
	 * Исходящие за ВСЁ время, а не за последние 30 суток.
	 *
	 * Журнал действий мы читаем окном — иначе у долгоживущего аккаунта запрос
	 * разрастается, — но наработка так теряется: аккаунт, который грели три
	 * недели весной, к лету снова выглядел бы чистым листом. Счётчик берём
	 * отдельным агрегатом по всей истории.
	 */
	private async outgoingLifetime(ids: string[]) {
		const rows = await this.prisma.tgWarmupAction.groupBy({
			by: ['accountId'],
			where: { accountId: { in: ids }, ok: true, kind: { in: OUTGOING as string[] } },
			_count: { _all: true },
		})
		return new Map(rows.map(r => [r.accountId, r._count._all]))
	}

	/** Журнал действий за 30 суток сразу по нескольким аккаунтам — одним запросом. */
	private async actionRows(ids: string[]) {
		const since = new Date(Date.now() - 30 * DAY_MS)
		const rows = await this.prisma.tgWarmupAction.findMany({
			where: { accountId: { in: ids }, createdAt: { gte: since } },
			select: { accountId: true, kind: true, createdAt: true, ok: true },
		})
		const map = new Map<string, typeof rows>()
		for (const r of rows) {
			const list = map.get(r.accountId)
			if (list) list.push(r)
			else map.set(r.accountId, [r])
		}
		return map
	}

	/** Тот же расчёт, но без обращений к базе: данные уже на руках. */
	private telemetryFrom(
		rows: Array<{ kind: string; createdAt: Date; ok: boolean }>,
		createdAt: Date,
		acc: { actionsTotal: number; warmupDaysDone: number; floodWaits: number; peerFloods: number; reauths: number } | null,
		outgoingAll?: number,
	) {
		const byDay = new Map<string, number>()
		for (const r of rows) byDay.set(dateKey(r.createdAt), (byDay.get(dateKey(r.createdAt)) ?? 0) + 1)

		// Ряд по дням строим сплошным, включая нули: пропущенные дни — это и есть
		// неравномерность, ради которой ряд считается.
		const actionsPerDay: number[] = []
		for (let i = 29; i >= 0; i--) {
			actionsPerDay.push(byDay.get(dateKey(new Date(Date.now() - i * DAY_MS))) ?? 0)
		}

		const daysManaged = Math.max(0, Math.floor((Date.now() - createdAt.getTime()) / DAY_MS))
		const firstDayEnd = createdAt.getTime() + DAY_MS
		const firstDay = rows.filter(r => r.createdAt.getTime() <= firstDayEnd).length
		const total = acc?.actionsTotal ?? rows.length

		const value: AccountTelemetry = {
			daysManaged,
			warmupDaysDone: acc?.warmupDaysDone ?? 0,
			actionsTotal: total,
			activeDaysLast30: actionsPerDay.filter(n => n > 0).length,
			actionsPerDay,
			firstDayActionShare: total > 0 ? firstDay / total : 0,
			floodWaits: acc?.floodWaits ?? 0,
			peerFloods: acc?.peerFloods ?? 0,
			revives: 0,
			reauths: acc?.reauths ?? 0,
		}
		return { value, outgoing: outgoingAll ?? rows.filter(r => OUTGOING.includes(r.kind as ActionKind) && r.ok).length }
	}

	/** Происхождение: номер, прокси, соседи по IP, размер пачки при заливке. */
	private async originFor(a: any): Promise<AccountOrigin> {
		const neighbors = a.proxyId
			? await this.prisma.tgAccount.count({ where: { proxyId: a.proxyId, id: { not: a.id } } })
			: 0
		// Размер пачки оцениваем по соседям в базе: за одну загрузку строки
		// создаются подряд, и разброс в минуту их надёжно склеивает.
		const batchSize = await this.prisma.tgAccount.count({
			where: {
				createdAt: {
					gte: new Date(a.createdAt.getTime() - 60_000),
					lte: new Date(a.createdAt.getTime() + 60_000),
				},
			},
		})
		return this.originFrom(a, neighbors, batchSize)
	}

	/** Та же сборка происхождения, но соседи и размер пачки уже посчитаны. */
	private originFrom(a: any, neighbors: number, batchSize: number): AccountOrigin {
		const proxyType = (a.proxy?.type ?? null) as AccountOrigin['proxyType']
		return {
			numberGeo: geoByPhone(a.phone),
			proxyType,
			proxyGeo: a.proxy?.geo ?? null,
			proxyAlive: a.proxy ? a.proxy.alive : true,
			neighborsOnIp: neighbors,
			// Постоянство адреса мы НЕ измеряем: для этого надо следить за точкой
			// выхода во времени, а мы её видим только в момент проверки. Раньше
			// значение выводилось из типа канала — и получалось, что тип
			// учитывается дважды: мобильный штрафовался за «подсеть» и в итоге
			// оказывался хуже дата-центра, хотя должен быть лучше всех.
			// Ставим нейтральное, а качество канала целиком судит его тип.
			ipStability: 'fixed',
			langCode: a.langCode ?? null,
			supplier: null,
			batchSize,
		}
	}

	/**
	 * Разговор со @SpamBot: спросить статус, нажать кнопку, отправить текст.
	 *
	 * Три действия вместо одной кнопки «снять блок» — потому что снимает его не
	 * кнопка, а человек на той стороне. Бот отвечает разным текстом с разными
	 * кнопками в зависимости от того, какое ограничение наложено, поэтому мы
	 * не разыгрываем заранее написанный сценарий, а показываем его ответ как
	 * есть и даём нажать то, что он предложил.
	 *
	 * Каждый шаг пишется в журнал аккаунта: если обращение не помогло, важно
	 * видеть, что именно бот отвечал и что мы жали.
	 */
	async spamBot(
		id: string,
		action: { kind: 'status' } | { kind: 'press'; index: number } | { kind: 'text'; text: string },
	) {
		const a = await this.prisma.tgAccount.findUnique({ where: { id }, include: { proxy: true } })
		if (!a) throw new NotFoundException('Аккаунт не найден')
		if (a.status === 'BANNED') {
			throw new BadRequestException('Аккаунт заблокирован — со SpamBot он уже не поговорит')
		}

		if (!(await this.claimAccount(a.id, 'check', 120))) {
			throw new BadRequestException('Аккаунт сейчас занят прогревом или рассылкой, попробуйте через минуту')
		}
		const opts = this.clientOptions(a)
		try {
			const { result, session } = await withClient(opts, async client => {
				if (action.kind === 'press') return pressButton(client, action.index)
				if (action.kind === 'text') return sendText(client, action.text)
				return askStatus(client)
			})
			await this.persistSession(a.id, opts.session, session)

			// В анкету пишем только когда бот действительно назвал статус.
			// После нажатия кнопки он отвечает вежливостью вроде «Всегда
			// пожалуйста», и разбор честно даёт unknown — затирать этим прежний
			// ответ нельзя, иначе результат проверки теряется следующим же шагом.
			const until = result.state === 'temporary' ? parseRestrictedUntil(result.text) : null
			if (result.state !== 'unknown') {
				const patch: any = {
					probe: { ...((a.probe as any) ?? {}), spamBlock: result.state, spamBlockUntil: until } as any,
				}
				// Бот сказал «чисто» — снимаем и плашку «заблокирован за флуд».
				if (result.state === 'clean') patch.lastError = null
				await this.prisma.tgAccount.update({ where: { id: a.id }, data: patch })
			}

			const what =
				action.kind === 'press' ? `нажата кнопка №${action.index + 1}`
					: action.kind === 'text' ? `отправлено: ${action.text}`
						: 'запрошен статус'
			await this.logEvent(
				a.id,
				action.kind === 'status' ? 'spam-check' : action.kind === 'press' ? 'spam-press' : 'spam-appeal',
				`${what}\nОтвет бота (${result.state}${until ? `, до ${until}` : ''}): ${result.text || '— пусто —'}`,
			)
			return { until, ...result }
		} catch (e: any) {
			const failure = e instanceof TgError ? e.failure : classifyError(e)
			await this.applyFailure(a.id, failure)
			throw new BadRequestException(`Не получилось: ${failure.message}`)
		} finally {
			await this.releaseAccount(a.id)
		}
	}

	/**
	 * Снять спам-флуд одной кнопкой: пишем /start и, если аккаунт под
	 * ограничением и бот дал кнопку обжалования, жмём первую нажимаемую.
	 *
	 * Это best-effort поверх spam-bot.ts, а не жёсткий сценарий: подписи кнопок
	 * у @SpamBot локализованы и меняются. Поэтому не угадываем нужную наперёд, а
	 * жмём первую callback/text-кнопку и возвращаем реальный ответ бота — если он
	 * попросит ещё шаг, владелец доводит вручную в карточке аккаунта.
	 */
	async spamAppeal(id: string) {
		const a = await this.prisma.tgAccount.findUnique({ where: { id }, include: { proxy: true } })
		if (!a) throw new NotFoundException('Аккаунт не найден')
		if (a.status === 'BANNED') {
			throw new BadRequestException('Аккаунт заблокирован — со SpamBot он уже не поговорит')
		}
		if (!(await this.claimAccount(a.id, 'check', 120))) {
			throw new BadRequestException('Аккаунт сейчас занят прогревом или рассылкой, попробуйте через минуту')
		}
		const opts = this.clientOptions(a)
		try {
			const { result, session } = await withClient(opts, async client => {
				const status = await askStatus(client)
				// Чисто — снимать нечего.
				if (status.state === 'clean') return { answer: status, pressed: null as string | null }
				// Нажимаемая кнопка обжалования: callback жмётся запросом, text —
				// отправкой того же текста; внешние ссылки пропускаем.
				const btn = status.buttons.find(b => b.kind === 'callback' || b.kind === 'text')
				if (!btn) return { answer: status, pressed: null as string | null }
				const after = await pressButton(client, btn.index)
				return { answer: after, pressed: btn.text }
			})
			await this.persistSession(a.id, opts.session, session)

			const until = result.answer.state === 'temporary' ? parseRestrictedUntil(result.answer.text) : null
			if (result.answer.state !== 'unknown') {
				const patch: any = {
					probe: { ...((a.probe as any) ?? {}), spamBlock: result.answer.state, spamBlockUntil: until } as any,
				}
				// Ограничение снято — убираем и плашку «заблокирован за флуд»: её
				// рисует lastError с меткой PEER_FLOOD, а бот только что сказал, что
				// аккаунт чист. Иначе плашка висела бы до первой удачной отправки.
				if (result.answer.state === 'clean') { patch.lastError = null; patch.spamRetryAt = null }
				await this.prisma.tgAccount.update({ where: { id: a.id }, data: patch })
			}
			await this.logEvent(
				a.id,
				'spam-appeal',
				`${result.pressed ? `обжалование: нажата «${result.pressed}»` : 'запрошен статус'}\n` +
					`Ответ бота (${result.answer.state}${until ? `, до ${until}` : ''}): ${result.answer.text || '— пусто —'}`,
			)
			return { pressed: result.pressed, until, ...result.answer }
		} catch (e: any) {
			const failure = e instanceof TgError ? e.failure : classifyError(e)
			await this.applyFailure(a.id, failure)
			throw new BadRequestException(`Не получилось: ${failure.message}`)
		} finally {
			await this.releaseAccount(a.id)
		}
	}

	// ── профиль в Telegram ───────────────────────────────────────────────────

	/** Текущий профиль прямо из Telegram: «о себе» и день рождения у нас не хранятся. */
	async getProfile(id: string) {
		const a = await this.prisma.tgAccount.findUnique({ where: { id }, include: { proxy: true } })
		if (!a) throw new NotFoundException('Аккаунт не найден')
		if (!(await this.claimAccount(a.id, 'check', 90))) {
			throw new BadRequestException('Аккаунт сейчас занят прогревом или рассылкой, попробуйте через минуту')
		}
		const opts = this.clientOptions(a)
		try {
			const { result, session } = await withClient(opts, client => readProfile(client))
			await this.persistSession(a.id, opts.session, session)
			return { ...result, avatar: a.avatar }
		} catch (e: any) {
			const failure = e instanceof TgError ? e.failure : classifyError(e)
			await this.applyFailure(a.id, failure)
			throw new BadRequestException(`Не получилось: ${failure.message}`)
		} finally {
			await this.releaseAccount(a.id)
		}
	}

	/**
	 * Правка профиля. Меняется только переданное; по каждому шагу — свой итог.
	 * После правки перечитываем имя, юзернейм и фото, чтобы список и карточка
	 * сразу показывали новое.
	 */
	async updateProfile(id: string, patch: ProfilePatch) {
		const a = await this.prisma.tgAccount.findUnique({ where: { id }, include: { proxy: true } })
		if (!a) throw new NotFoundException('Аккаунт не найден')
		if (a.status === 'BANNED') throw new BadRequestException('Аккаунт заблокирован — профиль не поменять')

		const bad = validateProfile(patch)
		if (bad) throw new BadRequestException(bad)
		if (!(await this.claimAccount(a.id, 'check', 180))) {
			throw new BadRequestException('Аккаунт сейчас занят прогревом или рассылкой, попробуйте через минуту')
		}
		const opts = this.clientOptions(a)
		try {
			const { result, session } = await withClient(opts, async client => {
				const steps = await applyProfile(client, patch)
				const now = await readProfile(client)
				// Маленькое фото, как при проверке: в списке оно кружок 36 пикселей.
				let avatar: string | null = null
				try {
					const photo = await client.downloadProfilePhoto('me', { isBig: false })
					if (photo && Buffer.isBuffer(photo) && photo.length > 0 && photo.length < 400_000) {
						avatar = `data:image/jpeg;base64,${photo.toString('base64')}`
					}
				} catch {}
				return { steps, now, avatar }
			})
			await this.persistSession(a.id, opts.session, session)

			await this.prisma.tgAccount.update({
				where: { id: a.id },
				data: {
					firstName: result.now.firstName || null,
					lastName: result.now.lastName || null,
					username: result.now.username || null,
					label: displayName(result.now) ?? a.label,
					// Фото удалили и нового нет — аватар тоже убираем.
					avatar: result.avatar ?? (patch.removePhoto && !patch.photos?.length ? null : a.avatar),
				},
			})
			await this.logEvent(
				a.id,
				'profile',
				result.steps.map(s => `${s.ok ? '✓' : '✗'} ${s.step}${s.message ? `: ${s.message}` : ''}`).join('\n') || 'нечего менять',
			)
			return { steps: result.steps, profile: { ...result.now, avatar: result.avatar ?? a.avatar } }
		} catch (e: any) {
			const failure = e instanceof TgError ? e.failure : classifyError(e)
			await this.applyFailure(a.id, failure)
			throw new BadRequestException(`Не получилось: ${failure.message}`)
		} finally {
			await this.releaseAccount(a.id)
		}
	}

	/**
	 * Автоснятие спам-лимита. Через сутки после PEER_FLOOD (spamRetryAt) сами
	 * пишем @SpamBot и обжалуем — то же, что кнопка «Снять спам-флуд», только без
	 * человека. По итогу шлём уведомление: сняли или нет и с каким рейтингом
	 * аккаунт вернулся.
	 *
	 * За тик берём немного (по одному подключаемся к Telegram — это не быстро) и
	 * идём по очереди. Временный блок ещё держится — тихо переносим попытку на
	 * несколько часов; уведомляем только по итогу (сняли / под замену), чтобы не
	 * сыпать «пока держится» каждый раз.
	 */
	async autoSpamAppeals(): Promise<{ tried: number; cleared: number }> {
		const now = new Date()
		const due = await this.prisma.tgAccount.findMany({
			where: {
				spamRetryAt: { lte: now },
				status: { notIn: ['BANNED', 'ERROR', 'PAUSED'] },
				lastError: { startsWith: 'PEER_FLOOD' },
			},
			select: { id: true, label: true },
			take: 5,
		})

		let cleared = 0
		for (const acc of due) {
			let state: string
			try {
				const res = await this.spamAppeal(acc.id)
				state = res.state
			} catch {
				// Занят прогревом/связь оборвалась — не насилуем @SpamBot, пробуем позже.
				await this.prisma.tgAccount
					.update({ where: { id: acc.id }, data: { spamRetryAt: new Date(Date.now() + 3 * 3600_000) } })
					.catch(() => {})
				continue
			}

			if (state === 'clean') {
				// Ограничение снято (spamAppeal уже вычистил метку и spamRetryAt).
				// Пересчитываем рейтинг с учётом снятого блока и сообщаем итог.
				const fresh = await this.prisma.tgAccount.findUnique({ where: { id: acc.id }, include: { proxy: true } })
				const scored = fresh?.probe ? (await this.scoreMany([fresh])).get(acc.id) : null
				if (scored) {
					await this.prisma.tgAccount.update({
						where: { id: acc.id },
						data: { score: scored.score, warmness: scored.warmness.total, advice: scored.advice as any, scoredAt: new Date() },
					})
				}
				cleared++
				const rating = scored
					? `\nРейтинг: <b>${scored.score.toFixed(1)}/10</b> (${scored.category}), прогрет на ${Math.round(scored.warmness.total)}%.`
					: ''
				await this.notifyAdmin(
					`✅ <b>Спам-лимит снят</b>\n\n` +
						`Аккаунт <b>${escapeHtml(acc.label ?? acc.id)}</b> — @SpamBot снял ограничение автоматически (через сутки). ` +
						`Снова в рассылке.${rating}`,
				)
			} else if (state === 'permanent') {
				await this.prisma.tgAccount.update({ where: { id: acc.id }, data: { spamRetryAt: null } })
				await this.notifyAdmin(
					`🚫 <b>Вечный спам-блок</b>\n\n` +
						`Аккаунт <b>${escapeHtml(acc.label ?? acc.id)}</b> — @SpamBot ограничение не снимает. Аккаунт под замену.`,
				)
			} else {
				// temporary/unknown — ещё держится. Тихо переносим попытку на 6 часов.
				await this.prisma.tgAccount.update({
					where: { id: acc.id },
					data: { spamRetryAt: new Date(Date.now() + 6 * 3600_000) },
				})
			}
		}
		return { tried: due.length, cleared }
	}

	/**
	 * Активные сессии аккаунта: кто ещё в него заходит.
	 *
	 * У купленного аккаунта почти всегда остаётся сессия продавца, и это не
	 * «след», а открытая дверь: с неё аккаунт в любой момент уводят вместе со
	 * всей перепиской.
	 *
	 * Завершение вынесено в отдельную ручку и делается человеком. Автомат тут
	 * опасен: «не наша сессия» иногда оказывается телефоном владельца, а
	 * отменить сброс нельзя. Флаг «двухфакторка выключена» точно так же
	 * показывается, а не чинится сам.
	 */
	async listSessions(id: string) {
		const a = await this.prisma.tgAccount.findUnique({ where: { id }, include: { proxy: true } })
		if (!a) throw new NotFoundException('Аккаунт не найден')
		if (!(await this.claimAccount(a.id, 'check', 120))) {
			throw new BadRequestException('Аккаунт сейчас занят прогревом или рассылкой, попробуйте через минуту')
		}
		const opts = this.clientOptions(a)
		try {
			const { result, session } = await withClient(opts, async client => {
				const res: any = await call(client, 'getAuthorizations', () =>
					client.invoke(new Api.account.GetAuthorizations()),
				)
				return (res?.authorizations ?? []).map((x: any) => ({
					hash: String(x.hash ?? '0'),
					current: !!x.current,
					device: [x.deviceModel, x.platform, x.systemVersion].filter(Boolean).join(' · ') || 'неизвестно',
					app: [x.appName, x.appVersion].filter(Boolean).join(' ') || null,
					ip: x.ip ?? null,
					country: x.country ?? null,
					createdAt: x.dateCreated ? new Date(Number(x.dateCreated) * 1000).toISOString() : null,
					activeAt: x.dateActive ? new Date(Number(x.dateActive) * 1000).toISOString() : null,
				}))
			})
			await this.persistSession(a.id, opts.session, session)
			return result
		} catch (e: any) {
			const failure = e instanceof TgError ? e.failure : classifyError(e)
			await this.applyFailure(a.id, failure)
			throw new BadRequestException(`Не получилось: ${failure.message}`)
		} finally {
			await this.releaseAccount(a.id)
		}
	}

	/** Завершить одну чужую сессию. Свою Telegram завершить не даст. */
	async resetSession(id: string, hash: string) {
		const a = await this.prisma.tgAccount.findUnique({ where: { id }, include: { proxy: true } })
		if (!a) throw new NotFoundException('Аккаунт не найден')
		if (!/^\d+$/.test(String(hash))) throw new BadRequestException('Неверный идентификатор сессии')
		if (!(await this.claimAccount(a.id, 'check', 120))) {
			throw new BadRequestException('Аккаунт сейчас занят прогревом или рассылкой, попробуйте через минуту')
		}
		const opts = this.clientOptions(a)
		try {
			const { session } = await withClient(opts, async client =>
				call(client, 'resetAuthorization', () =>
					client.invoke(new Api.account.ResetAuthorization({ hash: bigInt(String(hash)) })),
				),
			)
			await this.persistSession(a.id, opts.session, session)
			await this.logEvent(a.id, 'session-reset', `завершена чужая сессия (${hash})`)
			return { ok: true }
		} catch (e: any) {
			const failure = e instanceof TgError ? e.failure : classifyError(e)
			await this.applyFailure(a.id, failure)
			throw new BadRequestException(`Не получилось: ${failure.message}`)
		} finally {
			await this.releaseAccount(a.id)
		}
	}

	/**
	 * Плановая проверка у @SpamBot.
	 *
	 * Раньше статус ограничения узнавался только двумя путями: человек нажал
	 * кнопку или прилетел PEER_FLOOD. То есть поле «спам-блок», от которого
	 * зависят и оценка, и дневная норма, месяцами стояло тем, чем его оставила
	 * последняя ручная проверка.
	 *
	 * Раз в неделю и по три аккаунта за заход: /start боту — обычное действие
	 * живого пользователя, но полсотни таких запросов подряд с одного пула —
	 * уже нет.
	 */
	async routineSpamChecks(): Promise<{ checked: number }> {
		const since = new Date(Date.now() - SPAM_CHECK_EVERY_DAYS * DAY_MS)
		const fresh = await this.prisma.tgAccountEvent.findMany({
			where: { kind: 'spam-check', createdAt: { gte: since } },
			select: { accountId: true },
			distinct: ['accountId'],
		})
		const due = await this.prisma.tgAccount.findMany({
			where: {
				status: { in: ['READY', 'WARMING'] },
				id: { notIn: fresh.map(e => e.accountId) },
			},
			select: { id: true },
			take: 3,
		})
		let checked = 0
		for (const a of due) {
			try {
				await this.spamBot(a.id, { kind: 'status' })
				checked++
			} catch {
				// Занят, связь оборвалась, прокси лёг — не беда: следующий заход
				// возьмёт его снова, аккаунт всё равно останется просроченным.
			}
		}
		return { checked }
	}

	/**
	 * Карточка здоровья пула: одна строка на аккаунт.
	 *
	 * Состояние аккаунта собиралось по трём экранам — список, карточка,
	 * журнал, — и вопрос «почему этот перестал рассылать» каждый раз решался
	 * раскопками. Здесь ровно то, что нужно для этого вопроса, и ничего больше.
	 */
	async accountsHealth() {
		const now = new Date()
		const from7 = new Date(now.getTime() - 7 * DAY_MS)

		const accounts = await this.prisma.tgAccount.findMany({
			orderBy: { createdAt: 'desc' },
			include: {
				proxy: { select: { alive: true, type: true } },
				runs: {
					where: { status: { in: ['SCHEDULED', 'RUNNING'] } },
					orderBy: { startedAt: 'desc' },
					take: 1,
					select: { kind: true, dayIndex: true, days: true, nextRunAt: true },
				},
			},
		})

		const [allowances, sent, replied, refusals, checks] = await Promise.all([
			// Нормы считаем пачкой: поштучно это пять запросов на аккаунт, а
			// экран стал основным списком пула, а не редкой вкладкой.
			this.allowancesFor(accounts, 0, { settle: false }),
			this.prisma.tgRecipient.groupBy({
				by: ['accountId'],
				where: { accountId: { not: null }, sentAt: { gte: from7 } },
				_count: { _all: true },
			}),
			this.prisma.tgRecipient.groupBy({
				by: ['accountId'],
				where: { accountId: { not: null }, repliedAt: { gte: from7 } },
				_count: { _all: true },
			}),
			// Отказы считаем по стоп-листу — тем же способом, каким их считает
			// автоснижение темпа. Иначе на экране была бы одна доля, а решение
			// принималось бы по другой.
			this.prisma.tgStopList.groupBy({
				by: ['accountId'],
				where: { accountId: { not: null }, createdAt: { gte: from7 }, source: { in: ['blocked', 'opt-out'] } },
				_count: { _all: true },
			}),
			this.prisma.tgAccountEvent.findMany({
				where: { kind: 'spam-check' },
				orderBy: { createdAt: 'desc' },
				select: { accountId: true, createdAt: true, text: true },
				take: 500,
			}),
		])

		const sentBy = new Map(sent.map(r => [r.accountId!, r._count._all]))
		const repliedBy = new Map(replied.map(r => [r.accountId!, r._count._all]))
		const refusedBy = new Map(refusals.map(r => [r.accountId!, r._count._all]))
		const lastCheck = new Map<string, { at: Date; text: string }>()
		for (const e of checks) {
			if (!lastCheck.has(e.accountId)) lastCheck.set(e.accountId, { at: e.createdAt, text: e.text })
		}

		const rows = []
		for (const a of accounts) {
			const allow = allowances.get(a.id)!
			const probe: any = a.probe ?? {}
			const run = a.runs[0] ?? null
			const sent7 = sentBy.get(a.id) ?? 0
			const refused7 = refusedBy.get(a.id) ?? 0
			const check = lastCheck.get(a.id) ?? null

			// Состояние — ОДНА причина, самая тяжёлая. Список из пяти пометок
			// рядом с аккаунтом читается хуже, чем одна строка «что с ним».
			const state =
				a.status === 'BANNED' ? 'не в строю'
					: a.status === 'ERROR' ? 'сессия не поднялась'
						: a.status === 'PAUSED' ? 'ручная пауза'
							: probe.spamBlock === 'permanent' ? 'вечный спам-блок'
								: probe.spamBlock === 'temporary' ? 'спам-блок'
									: allow.throttle?.factor === 0 ? 'стоп после PEER_FLOOD'
										: (allow.throttle?.factor ?? 1) < 1 ? 'темп снижен'
											: !a.proxy?.alive ? 'прокси не отвечает'
												: 'ОК'

			rows.push({
				id: a.id,
				label: a.label ?? a.phone ?? a.id,
				avatar: a.avatar,
				mode: a.mode,
				status: a.status,
				state,
				// Чем занят прямо сейчас: срочный прогрев, фон или ничем.
				run: run ? { kind: run.kind, dayIndex: run.dayIndex, days: run.days, nextRunAt: run.nextRunAt } : null,
				sent7,
				replied7: repliedBy.get(a.id) ?? 0,
				refused7,
				// Доля отказов за неделю. Считается от отправленных: на нуле
				// отправленных доли нет вовсе, а не ноль процентов.
				refusalRate: sent7 ? Math.round((refused7 / sent7) * 1000) / 10 : null,
				dailyCap: allow.dailyMessages,
				readiness: allow.readiness,
				throttle: allow.throttle?.factor === 1 ? null : allow.throttle,
				why: allow.notes[0] ?? null,
				twoFactor: probe.twoFactor ?? null,
				activeSessions: probe.activeSessions ?? null,
				spamBlock: probe.spamBlock ?? 'unknown',
				spamCheckAt: check?.at ?? null,
				spamCheckText: check ? check.text.slice(0, 300) : null,
				// Когда бот сам спросит статус: либо плановая неделя, либо
				// назначенное обжалование после PEER_FLOOD — что раньше.
				spamCheckNextAt: a.spamRetryAt ?? (check ? new Date(check.at.getTime() + SPAM_CHECK_EVERY_DAYS * DAY_MS) : null),
				peerFloods: a.peerFloods,
				floodWaits: a.floodWaits,
				lastError: a.lastError,
			})
		}
		return rows
	}

	/**
	 * Лента прогрева: что сейчас, что уже было и что запланировано.
	 *
	 * Собирается из трёх источников — плана на сегодня, журнала действий и
	 * состояния прогона. Иначе понять, работает ли прогрев вообще, можно было
	 * только по счётчику действий, а он растёт раз в несколько часов и ничего
	 * не объясняет.
	 */
	/**
	 * Календарь прогрева на сутки — и рассылки на них же.
	 *
	 * Раньше увидеть, что аккаунт будет делать за день, можно было только в его
	 * карточке и только списком заходов. Вопрос при этом почти всегда общий:
	 * «что сегодня происходит по всему пулу», а не «что у третьего аккаунта».
	 *
	 * Прогрев и рассылка показаны на ОДНОЙ сетке намеренно. Аккаунт в режиме
	 * «Оба» днём и греется, и пишет, и увидеть это можно только рядом: заходы
	 * прогрева и отправки должны чередоваться, а не сваливаться в один час.
	 *
	 * План на сегодня берём тот, что построен воркером, — это и есть правда.
	 * На будущие дни считаем planDay заново: она детерминированная и от базы не
	 * зависит, так что показанное совпадёт с тем, что построится утром.
	 */
	async dayCalendar(date?: string): Promise<any> {
		const now = new Date()
		const today = startOfDayLocal(now)
		const target = parseDayLocal(date) ?? today
		const shift = Math.max(0, Math.round((target.getTime() - today.getTime()) / DAY_MS))

		const runs = await this.prisma.tgWarmupRun.findMany({
			where: { status: { in: ['SCHEDULED', 'RUNNING'] } },
			include: { account: true },
		})

		const accounts: any[] = []
		const items: any[] = []
		let lastDay = 0

		for (const run of runs) {
			const acc = run.account
			const upkeep = run.kind === 'UPKEEP'
			// Какой день прогрева придётся на выбранную дату. dayIndex ноль —
			// прогон заведён, но первый день ещё не начинался.
			const dayIndex = Math.max(1, run.dayIndex || 1) + shift
			// У фона срока нет, он идёт, пока аккаунт в пуле.
			if (!upkeep && dayIndex > run.days) continue
			if (!upkeep) lastDay = Math.max(lastDay, run.days - Math.max(1, run.dayIndex || 1))

			const ageDays = acc.registeredAt
				? Math.floor((Date.now() - acc.registeredAt.getTime()) / DAY_MS)
				: 30
			let planned: Session[] =
				shift === 0 && run.planDate === dateKey(target) && Array.isArray(run.plan)
					? (run.plan as unknown as Session[])
					: planDay({
							accountId: acc.id,
							dayIndex,
							runIndex: run.days,
							ageDays,
							windows: [{ fromHour: run.windowFrom, toHour: run.windowTo }],
							pace: upkeep ? 'calm' : ((run.pace as Pace) ?? 'normal'),
							rampDayIndex: upkeep ? 7 : undefined,
						}).sessions
			// На будущие дни пропуск фона считаем той же функцией, что и воркер:
			// календарь обязан показывать то, что действительно произойдёт.
			if (upkeep && shift > 0 && upkeepIdle(acc.id, dateKey(target), this.isGreen(acc))) planned = []

			const nowMin = mskMinuteOfDay(now)
			const doneToday = shift === 0 ? run.doneToday : 0
			planned.forEach((sess, i) => {
				const end = sess.startMin + sess.minutes
				items.push({
					kind: 'warm',
					accountId: acc.id,
					at: this.atMinute(target, sess.startMin).toISOString(),
					minutes: sess.minutes,
					actions: sess.actions,
					state: shift > 0 ? 'впереди'
						: i < doneToday ? 'прошёл'
							: sess.startMin <= nowMin && nowMin <= end ? 'идёт'
								: sess.startMin > nowMin ? 'впереди'
									: 'пропущен',
				})
			})

			const allow = await this.allowanceFor(acc, upkeep ? 0 : run.dayIndex || 0)
			accounts.push({
				id: acc.id,
				label: acc.label,
				avatar: acc.avatar,
				tgUserId: acc.tgUserId,
				mode: acc.mode,
				status: acc.status,
				readiness: allow.readiness,
				run: {
					kind: run.kind,
					dayIndex: Math.max(1, run.dayIndex || 1),
					days: run.days,
					pace: run.pace,
					paceLabel: PACE[(run.pace as Pace) ?? 'normal']?.label ?? null,
					windowFrom: run.windowFrom,
					windowTo: run.windowTo,
				},
				// Можно ли уже подключать рассылку и в каком объёме. Считаем по
				// той же норме, по которой рассылка потом и пойдёт, — обещать
				// одно, а выдавать другое нельзя.
				outreach: {
					canStart: allow.dailyMessages >= 1,
					perDay: allow.dailyMessages,
					why: allow.dailyMessages >= 1 ? null : (allow.notes[0] ?? 'исходящие пока закрыты'),
				},
			})
		}

		// Отправки рассылки на тот же день — по аккаунтам, которые здесь есть.
		const ids = accounts.map(a => a.id)
		if (ids.length) {
			const from = new Date(target)
			const to = new Date(target.getTime() + DAY_MS)
			const sends = await this.prisma.tgRecipient.findMany({
				where: { plannedAccountId: { in: ids }, scheduledAt: { gte: from, lt: to }, status: 'QUEUED' },
				select: {
					id: true, scheduledAt: true, plannedAccountId: true,
					firstName: true, lastName: true, company: true, username: true, phone: true,
					campaign: { select: { name: true } },
				},
				orderBy: { scheduledAt: 'asc' },
			})
			for (const r of sends) {
				items.push({
					kind: 'send',
					recipientId: r.id,
					accountId: r.plannedAccountId,
					at: r.scheduledAt!.toISOString(),
					who: [r.firstName, r.lastName].filter(Boolean).join(' ')
						|| r.company
						|| (r.username ? `@${r.username}` : null)
						|| r.phone
						|| 'без имени',
					campaign: r.campaign.name,
				})
			}
		}

		// Дни: сегодня и столько вперёд, сколько осталось у самого длинного прогона.
		const days: string[] = []
		for (let i = 0; i <= Math.min(13, lastDay); i++) {
			days.push(dateKey(new Date(today.getTime() + i * DAY_MS)))
		}

		return {
			date: dateKey(target),
			days,
			accounts: accounts.sort((a, b) => b.readiness - a.readiness),
			items: items.sort((a, b) => (a.at < b.at ? -1 : 1)),
		}
	}

	async timeline(accountId: string) {
		const a = await this.prisma.tgAccount.findUnique({
			where: { id: accountId },
			select: { id: true, label: true, status: true, registeredAt: true, createdAt: true, actionsTotal: true, warmupDaysDone: true },
		})
		if (!a) throw new NotFoundException('Аккаунт не найден')

		const run = await this.prisma.tgWarmupRun.findFirst({
			where: { accountId, status: { in: ['SCHEDULED', 'RUNNING'] } },
			orderBy: { startedAt: 'desc' },
		})

		const now = new Date()
		const nowMin = mskMinuteOfDay(now)
		const sessions: Session[] = Array.isArray(run?.plan) ? (run!.plan as unknown as Session[]) : []
		const doneToday = run?.doneToday ?? 0

		// Начало московских суток: по ним же считаются дневные нормы.
		const today = mskAt(new Date(), 0, 0)
		const actions = await this.prisma.tgWarmupAction.findMany({
			where: { accountId, createdAt: { gte: today } },
			orderBy: { createdAt: 'desc' },
			take: 60,
		})

		// Заходы с отметкой, что с ними: прошёл, идёт прямо сейчас или впереди.
		const plan = sessions.map((x, i) => {
			const endMin = x.startMin + x.minutes
			const state =
				i < doneToday ? 'прошёл'
					: x.startMin <= nowMin && nowMin <= endMin ? 'идёт'
						: x.startMin > nowMin ? 'впереди'
							: 'пропущен'
			return {
				index: i + 1,
				startMin: x.startMin,
				minutes: x.minutes,
				actions: x.actions,
				at: this.atMinute(now, x.startMin).toISOString(),
				state,
			}
		})

		return {
			account: { id: a.id, label: a.label, status: a.status },
			run: run
				? {
						id: run.id, day: run.dayIndex || 1, days: run.days,
						status: run.status, nextRunAt: run.nextRunAt,
						planDate: run.planDate,
					}
				: null,
			// Сколько всего сегодня в сети и сколько уже прошло.
			todayMinutes: sessions.reduce((s, x) => s + x.minutes, 0),
			todayActions: sessions.reduce((s, x) => s + x.actions, 0),
			doneSessions: doneToday,
			plan,
			actions: actions.map(x => ({
				id: x.id, kind: x.kind, ok: x.ok, detail: x.detail, at: x.createdAt,
			})),
		}
	}

	/**
	 * Общая лента по всему пулу: что делали аккаунты, что сломалось, что ушло.
	 *
	 * Собирается из трёх источников, потому что события живут в разных таблицах
	 * и по отдельности не отвечают на вопрос «что вообще происходит»:
	 *   действия прогрева  — чтение, вступления, реакции;
	 *   события аккаунтов  — баны, разлогины, разговоры со спам-ботом;
	 *   отправки рассылки  — первые касания и ответы.
	 *
	 * Слияние делаем в памяти, а не запросом с UNION: таблицы разной формы, а
	 * объём тут — сотни строк за сутки, не миллионы.
	 */
	async activity(opts?: { filter?: 'all' | 'errors' | 'ok'; accountId?: string; limit?: number }) {
		const take = Math.max(10, Math.min(500, opts?.limit ?? 200))
		// Из каждого источника берём с запасом: фильтр по сбоям применяется уже
		// после слияния, и без запаса «покажи 5 ошибок» возвращало две — просто
		// потому, что в пятёрке свежих строк каждого источника их столько и было.
		const grab = Math.min(1000, take * 4)
		const where = opts?.accountId ? { accountId: opts.accountId } : {}

		const [actions, events, sends] = await Promise.all([
			this.prisma.tgWarmupAction.findMany({
				where,
				orderBy: { createdAt: 'desc' },
				take: grab,
				include: { account: { select: { id: true, label: true, avatar: true } } },
			}),
			this.prisma.tgAccountEvent.findMany({
				where,
				orderBy: { createdAt: 'desc' },
				take: grab,
				include: { account: { select: { id: true, label: true, avatar: true } } },
			}),
			this.prisma.tgRecipient.findMany({
				where: { ...where, OR: [{ sentAt: { not: null } }, { error: { not: null } }] },
				orderBy: { createdAt: 'desc' },
				take: grab,
				include: { account: { select: { id: true, label: true, avatar: true } } },
			}),
		])

		type Row = {
			id: string
			at: Date
			source: 'прогрев' | 'аккаунт' | 'рассылка'
			kind: string
			ok: boolean
			text: string
			account: { id: string; label: string | null; avatar: string | null } | null
		}

		const rows: Row[] = [
			...actions.map(a => ({
				id: `a:${a.id}`, at: a.createdAt, source: 'прогрев' as const,
				kind: a.kind, ok: a.ok, text: a.detail ?? '', account: a.account,
			})),
			...events.map(e => ({
				id: `e:${e.id}`, at: e.createdAt, source: 'аккаунт' as const,
				kind: e.kind,
				// Бан, разлогин и спам-лимит — это отказы, остальное просто отметки.
				ok: !['banned', 'unauthorized', 'peer-flood'].includes(e.kind),
				text: e.text, account: e.account,
			})),
			...sends
				.filter(r => r.account)
				.map(r => ({
					id: `s:${r.id}`,
					at: r.sentAt ?? r.createdAt,
					source: 'рассылка' as const,
					kind: r.error ? 'send-failed' : 'send',
					ok: !r.error,
					text: r.error
						? `${r.username ? '@' + r.username : r.phone}: ${r.error}`
						: `${r.username ? '@' + r.username : r.phone}${r.domain ? ` · ${r.domain}` : ''}`,
					account: r.account!,
				})),
		]

		const filtered =
			opts?.filter === 'errors' ? rows.filter(r => !r.ok)
				: opts?.filter === 'ok' ? rows.filter(r => r.ok)
					: rows

		return {
			rows: filtered.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, take),
			counts: { all: rows.length, errors: rows.filter(r => !r.ok).length, ok: rows.filter(r => r.ok).length },
		}
	}

	/** Журнал событий аккаунта: баны, разлогины, разговоры со SpamBot. */
	async events(accountId: string, limit = 50) {
		return this.prisma.tgAccountEvent.findMany({
			where: { accountId },
			orderBy: { createdAt: 'desc' },
			take: Math.max(1, Math.min(200, limit)),
		})
	}

	// ── список каналов ───────────────────────────────────────────────────────

	/**
	 * Что владелец выключил в настройках прогрева.
	 *
	 * Храним ВЫКЛЮЧЕННЫЕ, а не включённые: тогда новое действие, добавленное
	 * позже, включается само и не приходится трогать настройки у всех.
	 */
	async getDisabledActions(): Promise<Set<string>> {
		const row = await this.prisma.appConfig.findUnique({ where: { key: KEY_ACTIONS } })
		if (!row?.value) return new Set()
		try {
			const list = JSON.parse(row.value)
			return new Set(Array.isArray(list) ? list.map(String) : [])
		} catch {
			return new Set()
		}
	}

	async setDisabledActions(ids: string[]) {
		const known = new Set(catalogInfo().map(a => a.id))
		const value = JSON.stringify([...new Set(ids ?? [])].filter(id => known.has(id as any)))
		await this.prisma.appConfig.upsert({
			where: { key: KEY_ACTIONS },
			create: { key: KEY_ACTIONS, value },
			update: { value },
		})
		return { disabled: JSON.parse(value).length }
	}

	/** Каталог действий с пометкой, что включено. */
	async actionsCatalog() {
		const disabled = await this.getDisabledActions()
		return catalogInfo().map(a => ({ ...a, enabled: !disabled.has(a.id) }))
	}

	async getChannels(): Promise<string[]> {
		const row = await this.prisma.appConfig.findUnique({ where: { key: KEY_CHANNELS } })
		if (!row?.value) return DEFAULT_CHANNELS
		const list = row.value.split(/[\s,]+/).map(s => s.replace(/^@/, '').trim()).filter(Boolean)
		return list.length ? list : DEFAULT_CHANNELS
	}

	/**
	 * Пара приложения по умолчанию.
	 *
	 * api_id и api_hash опознают КЛИЕНТ, а не аккаунт: MTProto отправляет их в
	 * initConnection при каждом подключении, без них соединение не поднимается
	 * вовсе. Поэтому вводится это один раз и лежит здесь, а не запрашивается
	 * при каждой загрузке.
	 *
	 * ВАЖНО про приоритет: если поставщик положил app_id рядом с сессией, берётся
	 * ЕГО, а не эта пара. Приложение — часть отпечатка наравне с устройством, и
	 * сессия, созданная одним клиентом, должна и дальше ходить под ним же.
	 */
	async getApiDefaults(): Promise<{ apiId: number | null; apiHash: string | null }> {
		const rows = await this.prisma.appConfig.findMany({ where: { key: { in: [KEY_API_ID, KEY_API_HASH] } } })
		const id = Number(rows.find(r => r.key === KEY_API_ID)?.value)
		return {
			apiId: Number.isFinite(id) && id > 0 ? id : null,
			apiHash: rows.find(r => r.key === KEY_API_HASH)?.value || null,
		}
	}

	async setApiDefaults(apiId?: number | string | null, apiHash?: string | null) {
		const id = Number(apiId)
		const hash = String(apiHash ?? '').trim()
		if (!Number.isFinite(id) || id <= 0) throw new BadRequestException('api_id должен быть числом больше нуля')
		// Хеш всегда 32 шестнадцатеричных символа. Проверяем здесь, потому что
		// ошибка в нём вылезет только при подключении, уже после загрузки пачки.
		if (!/^[0-9a-f]{32}$/i.test(hash)) {
			throw new BadRequestException('api_hash должен быть 32 символами из цифр и букв a-f')
		}
		await this.prisma.appConfig.upsert({
			where: { key: KEY_API_ID }, create: { key: KEY_API_ID, value: String(id) }, update: { value: String(id) },
		})
		await this.prisma.appConfig.upsert({
			where: { key: KEY_API_HASH }, create: { key: KEY_API_HASH, value: hash }, update: { value: hash },
		})
		return { ok: true }
	}

	async setChannels(text: string) {
		const list = String(text ?? '').split(/[\s,]+/).map(s => s.replace(/^@/, '').trim()).filter(Boolean)
		await this.prisma.appConfig.upsert({
			where: { key: KEY_CHANNELS },
			create: { key: KEY_CHANNELS, value: list.join('\n') },
			update: { value: list.join('\n') },
		})
		return { count: list.length }
	}

	// ── запуск прогрева ──────────────────────────────────────────────────────

	/**
	 * Поставить аккаунты на прогрев.
	 *
	 * Первое пробуждение назначается на случайную минуту внутри окна активности
	 * — и она разная у разных аккаунтов, потому что считается от id. Иначе
	 * весь пул просыпался бы одновременно, а синхронный старт сотни аккаунтов
	 * виден лучше, чем любая отдельная активность.
	 */
	/**
	 * Что означает каждый темп — числами, а не словами.
	 *
	 * Считается на бэкенде, а не рисуется на фронте: цифры должны браться
	 * оттуда же, откуда их берёт планировщик, иначе интерфейс однажды начнёт
	 * обещать одно, а прогрев делать другое.
	 */
	paceInfo() {
		const stages: Array<{ key: 'new' | 'warm' | 'mature'; label: string; note: string }> = [
			{ key: 'new', label: 'Новый', note: 'моложе недели' },
			{ key: 'warm', label: 'Обжитой', note: 'от недели до месяца' },
			{ key: 'mature', label: 'Зрелый', note: 'старше месяца' },
		]
		return {
			stages,
			paces: PACES.map(p => ({
				id: p,
				label: PACE[p].label,
				hint: PACE[p].hint,
				sessions: PACE[p].sessions,
				byStage: stages.map(st => ({
					stage: st.key,
					actions: PACE[p].actions[st.key],
					minutes: paceMinutes(st.key, p),
				})),
			})),
		}
	}

	async startWarmup(ids: string[], days: number, windowFrom = 9, windowTo = 23, pace: Pace = 'normal') {
		if (!ids?.length) throw new BadRequestException('Не выбрано ни одного аккаунта')
		const d = Math.max(1, Math.min(60, Math.round(days || 7)))
		if (windowTo <= windowFrom) throw new BadRequestException('Окно активности задано наоборот: конец раньше начала')
		const speed: Pace = PACES.includes(pace) ? pace : 'normal'

		const accounts = await this.prisma.tgAccount.findMany({
			where: { id: { in: ids } },
			select: { id: true, status: true, mode: true },
		})
		const started: string[] = []
		const skipped: Array<{ id: string; reason: string }> = []

		for (const a of accounts) {
			if (a.status === 'BANNED') {
				skipped.push({ id: a.id, reason: 'аккаунт заблокирован' })
				continue
			}
			if (a.status === 'PAUSED') {
				skipped.push({ id: a.id, reason: 'аккаунт на паузе — сначала снимите её' })
				continue
			}
			if (a.mode === 'SEND') {
				skipped.push({ id: a.id, reason: 'аккаунт отведён только под рассылку' })
				continue
			}
			const active = await this.prisma.tgWarmupRun.findFirst({
				where: { accountId: a.id, kind: 'WARMUP', status: { in: ['SCHEDULED', 'RUNNING'] } },
				select: { id: true },
			})
			if (active) {
				skipped.push({ id: a.id, reason: 'прогрев уже идёт' })
				continue
			}
			// Фон уступает место прогреву. Два прогона на один аккаунт — это и
			// двойная норма действий за сутки, и две попытки захватить одну
			// сессию: Telegram видит два одновременных подключения.
			await this.prisma.tgWarmupRun.updateMany({
				where: { accountId: a.id, kind: 'UPKEEP', status: { in: ['SCHEDULED', 'RUNNING'] } },
				data: { status: 'STOPPED', finishedAt: new Date() },
			})
			await this.prisma.tgWarmupRun.create({
				data: {
					accountId: a.id,
					days: d,
					windowFrom, windowTo,
					pace: speed,
					status: 'SCHEDULED',
					nextRunAt: this.nextStart(a.id, new Date(), { fromHour: windowFrom, toHour: windowTo }),
				},
			})
			await this.prisma.tgAccount.update({ where: { id: a.id }, data: { status: 'WARMING' } })
			started.push(a.id)
		}
		return { started: started.length, skipped, pace: speed }
	}

	/**
	 * Аккаунт «в зелёной зоне»: Telegram к нему не придирался и он прогрет.
	 * Считается по сохранённым полям, без единого запроса, — решение о пропуске
	 * фонового дня не стоит похода в базу.
	 */
	private isGreen(a: any): boolean {
		const probe: any = a.probe ?? {}
		return (
			(a.warmness ?? 0) >= 70 &&
			(a.floodWaits ?? 0) === 0 &&
			(a.peerFloods ?? 0) === 0 &&
			(probe.spamBlock ?? 'unknown') === 'clean'
		)
	}

	/**
	 * Завести фон там, где его ещё нет.
	 *
	 * Берутся только готовые аккаунты без активного прогона: у тех, кто сейчас
	 * греется, фон уже есть — это сам прогрев. Аккаунт на ручной паузе не
	 * трогаем: пауза для того и нужна, чтобы к нему никто не ходил.
	 *
	 * Прогрев, доведённый до конца, попадает сюда сам: он ставит аккаунту
	 * READY и снимает прогон, а дальше фон подхватывается ближайшим тиком.
	 * Отдельной ветки в finishRun для этого не нужно — одно место вместо двух.
	 */
	async ensureUpkeep(): Promise<number> {
		const accounts = await this.prisma.tgAccount.findMany({
			where: {
				status: 'READY',
				runs: { none: { status: { in: ['SCHEDULED', 'RUNNING'] } } },
			},
			select: {
				id: true,
				// Окно берём то, в котором аккаунт грелся: человек выставил его
				// под свой часовой пояс и легенду, и менять это молча нельзя.
				runs: { orderBy: { startedAt: 'desc' }, take: 1, select: { windowFrom: true, windowTo: true } },
			},
		})
		for (const a of accounts) {
			const last = a.runs[0]
			const w = { fromHour: last?.windowFrom ?? 9, toHour: last?.windowTo ?? 23 }
			await this.prisma.tgWarmupRun.create({
				data: {
					accountId: a.id,
					kind: 'UPKEEP',
					days: 0, // у фона нет срока
					windowFrom: w.fromHour, windowTo: w.toHour,
					pace: 'calm',
					status: 'SCHEDULED',
					nextRunAt: this.nextStart(a.id, new Date(), w),
				},
			})
		}
		return accounts.length
	}

	/**
	 * Остановить прогрев. Фон при этом остаётся: «стоп» здесь означает
	 * «хватит греть», а не «замолчи совсем». Замолчать совсем — это пауза
	 * аккаунта, она снимает и фон тоже и не даёт ему завестись заново.
	 */
	async stopWarmup(ids: string[]) {
		await this.prisma.tgWarmupRun.updateMany({
			where: { accountId: { in: ids }, kind: 'WARMUP', status: { in: ['SCHEDULED', 'RUNNING'] } },
			data: { status: 'STOPPED', finishedAt: new Date() },
		})
		await this.prisma.tgAccount.updateMany({
			where: { id: { in: ids }, status: 'WARMING' },
			data: { status: 'READY' },
		})
		return { ok: true }
	}

	/**
	 * Минуты от начала МОСКОВСКИХ суток.
	 *
	 * Окна активности прогрева подписаны «по МСК», а контейнер работает в UTC:
	 * без пересчёта аккаунт, которому положено просыпаться в 9 утра, выходил
	 * бы в сеть в полдень.
	 */
	private minuteOfDay(d: Date): number {
		return mskMinuteOfDay(d)
	}

	/** Момент времени по минуте московских суток указанного дня. */
	private atMinute(day: Date, minute: number): Date {
		return mskAt(day, 0, 0, minute)
	}

	// ── исполнение ───────────────────────────────────────────────────────────

	/**
	 * Тик планировщика: забрать созревшие прогоны и отработать их.
	 *
	 * Захват строки атомарный — updateMany с проверкой количества. Без него два
	 * тика могли бы взять один прогон, если предыдущий подвис на сети, и один
	 * аккаунт получил бы двойную норму действий за день.
	 */
	async tick(limit = 10): Promise<number> {
		const now = new Date()
		// Замок старше получаса считаем протухшим: значит воркер упал в процессе.
		const stale = new Date(now.getTime() - 30 * 60_000)
		const due = await this.prisma.tgWarmupRun.findMany({
			where: {
				status: { in: ['SCHEDULED', 'RUNNING'] },
				nextRunAt: { lte: now },
				OR: [{ lockedAt: null }, { lockedAt: { lt: stale } }],
			},
			orderBy: { nextRunAt: 'asc' },
			take: limit,
			select: { id: true, lockedAt: true },
		})

		// Прогоны идут пачками по несколько штук сразу. Строго по очереди нельзя:
		// внутри одного захода есть настоящие паузы между действиями и таймауты
		// подключения, и пул из полусотни аккаунтов не успевал бы за сутки.
		// Больше четырёх одновременно не берём: у каждого свой прокси и своё
		// соединение, а сеть у контейнера одна.
		const CONCURRENCY = 4
		let handled = 0
		const queue = [...due]
		const worker = async () => {
			for (;;) {
				const row = queue.shift()
				if (!row) return
				const claimed = await this.prisma.tgWarmupRun.updateMany({
					where: { id: row.id, lockedAt: row.lockedAt },
					data: { lockedAt: new Date(), status: 'RUNNING' },
				})
				if (claimed.count !== 1) continue // другой тик успел раньше

				try {
					await this.runDay(row.id)
					handled++
				} catch (e: any) {
					this.logger.error(`Прогон ${row.id} упал: ${e?.message ?? e}`)
					await this.prisma.tgWarmupRun.update({
						where: { id: row.id },
						data: { lastError: String(e?.message ?? e).slice(0, 500) },
					})
				} finally {
					await this.prisma.tgWarmupRun.update({ where: { id: row.id }, data: { lockedAt: null } })
				}
			}
		}
		await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker))
		return handled
	}

	/**
	 * Отработать очередное пробуждение одного прогона.
	 *
	 * План строится на календарные сутки один раз и лежит в базе. Держать его в
	 * памяти нельзя: перезапуск сервиса обнулил бы прогресс, и аккаунт получил
	 * бы дневную норму заново — то есть ровно тот всплеск, от которого прогрев
	 * и должен защищать.
	 */
	private async runDay(runId: string): Promise<void> {
		const run = await this.prisma.tgWarmupRun.findUnique({
			where: { id: runId },
			include: { account: { include: { proxy: true } } },
		})
		if (!run || run.status === 'STOPPED' || run.status === 'DONE') return

		const account = run.account
		/*
		 * Фон (UPKEEP) — бессрочный прогон после прогрева.
		 *
		 * Он и заводится ради аккаунтов в рассылке: без него аккаунт между
		 * отправками не делает вообще ничего и для Telegram выглядит заведённым
		 * ради исходящего потока. Поэтому отвод «только под рассылку» фон не
		 * отменяет, в отличие от прогрева: объём у фона вчетверо меньше и
		 * сообщений в нём нет.
		 */
		const upkeep = run.kind === 'UPKEEP'
		// Аккаунт, отведённый только под рассылку, не греем: он и так работает,
		// а два занятия сразу — двойная нагрузка на одну сессию.
		if (account.mode === 'SEND' && !upkeep) {
			await this.prisma.tgWarmupRun.update({
				where: { id: run.id },
				data: { nextRunAt: new Date(Date.now() + 3600_000), lastError: 'аккаунт отведён под рассылку' },
			})
			return
		}
		// Аккаунт на ручной паузе не трогаем вовсе — ни чтением, ни чем-либо ещё.
		if (account.status === 'PAUSED') {
			await this.prisma.tgWarmupRun.update({
				where: { id: run.id },
				data: { nextRunAt: new Date(Date.now() + 3600_000) },
			})
			return
		}
		const now = new Date()
		const today = dateKey(now)
		const window: Window = { fromHour: run.windowFrom, toHour: run.windowTo }

		// Новые сутки — новый план и новый день прогрева.
		let dayIndex = run.dayIndex
		let plan: Session[] = Array.isArray(run.plan) ? (run.plan as unknown as Session[]) : []
		let doneToday = run.doneToday

		if (run.planDate !== today) {
			dayIndex = run.dayIndex + 1
			// Фон не заканчивается: пока аккаунт в пуле, он каждый день заходит.
			if (!upkeep && dayIndex > run.days) {
				await this.finishRun(run.id, account.id, 'DONE')
				return
			}
			const ageDays = account.registeredAt
				? Math.floor((now.getTime() - account.registeredAt.getTime()) / DAY_MS)
				: 0
			const built = planDay({
				accountId: account.id,
				dayIndex,
				runIndex: run.days,
				ageDays,
				windows: [window],
				// Фон идёт самым бережным темпом и без разгона: аккаунт уже
				// прогрет, это поддержание присутствия, а не подъём нормы.
				pace: upkeep ? 'calm' : ((run.pace as Pace) ?? 'normal'),
				rampDayIndex: upkeep ? 7 : undefined,
			})
			plan = built.sessions
			// Зелёному аккаунту фон иногда пропускаем: сплошная цепочка дней
			// без единого пропуска — сама по себе узор.
			if (upkeep && upkeepIdle(account.id, today, this.isGreen(account))) plan = []
			doneToday = 0
			await this.prisma.tgWarmupRun.update({
				where: { id: run.id },
				data: { dayIndex, planDate: today, plan: plan as any, doneToday: 0 },
			})
			// Прошлый день закрыт — засчитываем его аккаунту. Дни фона в счётчик
			// прогрева не идут: он про то, сколько аккаунт грели, а не про то,
			// сколько он вообще прожил в пуле.
			if (run.planDate && !upkeep) {
				await this.prisma.tgAccount.update({
					where: { id: account.id },
					data: { warmupDaysDone: { increment: 1 } },
				})
			}
		}

		const minuteNow = this.minuteOfDay(now)
		// Какой заход сейчас должен идти: первый невыполненный, чьё время уже
		// наступило. Пропущенные не догоняем — заход, начавшийся на три часа
		// позже плана, это уже не тот заход, а всплеск активности среди ночи.
		let index = doneToday
		while (index < plan.length && plan[index].startMin + plan[index].minutes + 30 < minuteNow) {
			index++
		}
		if (index > doneToday) {
			this.logger.warn(`Аккаунт ${account.id}: пропущено заходов ${index - doneToday}, догонять не будем`)
			doneToday = index
		}

		const session = plan[index]
		if (!session || session.startMin > minuteNow) {
			// Ещё рано — спим до следующего захода.
			await this.scheduleNext(run.id, account.id, plan, doneToday, now, window)
			return
		}

		const channels = await this.getChannels()
		const disabled = await this.getDisabledActions()
		const peer = await this.pickPeer(account.id)
		const usedToday = await this.usedToday(account.id)
		// У фона нет дня прогрева: ноль означает «прогрев не идёт», то есть без
		// разгона и без режима первых читающих суток. Иначе только что заведённый
		// фон на два дня закрыл бы аккаунту даже реакции.
		// settle: воркер реально работает аккаунтом, ему и утверждать норму дня.
		// Читающие экраны норму считают, но не записывают — иначе судьбу дня
		// решал бы тот, кто первым открыл админку. Записывать или нет, решает
		// сам расчёт: он утверждает только норму «вообще», без дня разгона.
		const allow = await this.allowanceFor(account, upkeep ? 0 : dayIndex, { settle: true })

		const opts = this.clientOptions(account)
		const rnd = makeRng(accountSeed(account.id) + dayIndex * 7919 + index)
		// Паузы внутри захода растягивают его примерно на заявленные минуты:
		// заход на семь минут, отработанный за двадцать секунд, — это не заход.
		const gapMs = Math.max(15_000, Math.round((session.minutes * 60_000) / Math.max(1, session.actions)))

		// Заход может длиться до восемнадцати минут — столько и держим захват,
		// плюс запас на подключение.
		if (!(await this.claimAccount(account.id, 'warmup', session.minutes * 60 + 180))) {
			this.logger.warn(`Аккаунт ${account.id} занят рассылкой — заход пропущен`)
			await this.scheduleNext(run.id, account.id, plan, doneToday, now, window)
			return
		}

		let done = 0
		try {
			const { session: saved } = await withClient(opts, async client => {
				for (let i = 0; i < session.actions; i++) {
					const outcome = await runAction({
						client,
						rnd,
						channels,
						allowOutgoing: allow.allowOutgoing,
						canJoin: allow.maxJoinsPerDay > usedToday.joins,
						canMessage: allow.maxMessagesPerDay > usedToday.messages,
						canReact: allow.maxReactionsPerDay > usedToday.reactions,
						peer,
						// Ключ пары не зависит от того, кто пишет первым: у обоих
						// аккаунтов должен быть один и тот же разговор.
						chatKey: peer ? [account.username ?? account.id, peer].sort().join(':') : undefined,
						chatIndex: usedToday.messages + dayIndex * 7,
						disabled,
					})
					await this.prisma.tgWarmupAction.create({
						data: {
							accountId: account.id, runId: run.id, dayIndex,
							kind: outcome.kind, ok: true, detail: outcome.detail?.slice(0, 400) ?? null,
						},
					})
					if (outcome.kind === 'join') usedToday.joins++
					else if (outcome.kind === 'peer-chat') usedToday.messages++
					else if (REACTION_KINDS.has(outcome.kind)) usedToday.reactions++
					done++
					if (i < session.actions - 1) await sleep(gapMs * (0.6 + rnd() * 0.8))
				}
				return null
			})
			await this.persistSession(account.id, opts.session, saved)

			doneToday = index + 1
			await this.prisma.tgAccount.update({
				where: { id: account.id },
				data: {
					actionsTotal: { increment: done },
					lastCheckAt: new Date(),
					lastError: null,
					...(account.status === 'ERROR' ? { status: 'WARMING' as const } : {}),
				},
			})
			await this.prisma.tgWarmupRun.update({
				where: { id: run.id },
				data: { doneToday, lastError: null },
			})
		} catch (e: any) {
			const failure = e instanceof TgError ? e.failure : classifyError(e)
			await this.applyFailure(account.id, failure)
			// Заход считаем состоявшимся, даже если он оборвался: повторять его
			// через минуту значит долбиться в стену, которая уже ответила.
			doneToday = index + 1
			await this.prisma.tgWarmupRun.update({
				where: { id: run.id },
				data: { doneToday, lastError: failure.message.slice(0, 500) },
			})
			if (done > 0) {
				await this.prisma.tgAccount.update({
					where: { id: account.id },
					data: { actionsTotal: { increment: done } },
				})
			}

			if (failure.kind === 'banned' || failure.kind === 'frozen' || failure.kind === 'unauthorized') {
				await this.finishRun(run.id, account.id, 'FAILED')
				await this.releaseAccount(account.id)
				return
			}
			if (failure.kind === 'flood' && failure.seconds) {
				await this.prisma.tgWarmupRun.update({
					where: { id: run.id },
					data: { nextRunAt: new Date(now.getTime() + (failure.seconds + 60) * 1000), status: 'SCHEDULED' },
				})
				await this.releaseAccount(account.id)
				return
			}
			if (failure.kind === 'peerFlood') {
				await this.prisma.tgWarmupRun.update({
					where: { id: run.id },
					data: { nextRunAt: this.nextStart(account.id, new Date(now.getTime() + DAY_MS), window), status: 'SCHEDULED' },
				})
				await this.releaseAccount(account.id)
				return
			}
		}

		await this.releaseAccount(account.id)
		await this.scheduleNext(run.id, account.id, plan, doneToday, now, window)
	}

	/** Следующее пробуждение: ближайшая невыполненная минута плана или завтра. */
	private async scheduleNext(
		runId: string, accountId: string, plan: Session[], doneToday: number, now: Date, window: Window,
	): Promise<void> {
		const rest = plan.slice(doneToday).filter(x => this.atMinute(now, x.startMin) > now)
		const next = rest.length
			? this.atMinute(now, rest[0].startMin)
			: this.nextStart(accountId, new Date(now.getTime() + 60_000), window)
		await this.prisma.tgWarmupRun.update({
			where: { id: runId },
			data: { nextRunAt: next, status: 'SCHEDULED' },
		})
	}

	private async finishRun(runId: string, accountId: string, status: 'DONE' | 'FAILED'): Promise<void> {
		await this.prisma.tgWarmupRun.update({
			where: { id: runId },
			data: { status, finishedAt: new Date(), nextRunAt: null },
		})
		const acc = await this.prisma.tgAccount.findUnique({ where: { id: accountId }, select: { status: true } })
		if (acc?.status === 'WARMING') {
			await this.prisma.tgAccount.update({
				where: { id: accountId },
				data: { status: status === 'DONE' ? 'READY' : 'ERROR' },
			})
		}
	}

	/**
	 * Разрешение на исходящие для конкретного аккаунта.
	 *
	 * Собирает всё, что о нём известно: возраст по id, сколько суток он у нас,
	 * что записано в журнале, анкету последней проверки, счётчики флудов.
	 * Если анкеты ещё нет, подписки считаем по собственному журналу вступлений
	 * — иначе аккаунт, который сам себе набрал каналов, выглядел бы пустым.
	 */
	async allowanceFor(account: any, dayIndex: number, opts?: { settle?: boolean }): Promise<Allowance> {
		const now = new Date()
		const counters = await this.allowanceCounters([account.id], now)
		const { allowance, settleCap } = this.allowanceFrom(account, dayIndex, counters.get(account.id)!, now)
		if (settleCap !== null && opts?.settle) {
			await this.settleCaps([account.id], settleCap, now)
		}
		return allowance
	}

	/**
	 * Записать утверждённую на сегодня норму.
	 *
	 * updateMany с условием, а не update по id: норму утверждает ПЕРВЫЙ
	 * посчитавший. Без условия два одновременных вызова — тик рассылки и заход
	 * прогрева — перетирали бы друг друга, и суточным потолком становилось
	 * случайное из двух чисел.
	 *
	 * Условие расписано через OR, а не коротким `not`. У поля, которое умеет
	 * быть пустым, `not` разворачивается в голое `<>`, а `NULL <> '2026-09-20'`
	 * в SQL — не истина, а неизвестность: строка под условие не подходит. То
	 * есть самая первая запись нормы, когда поле ещё пустое, не проходила бы
	 * никогда, и ступень роста не работала бы вовсе.
	 */
	private async settleCaps(ids: string[], cap: number, now: Date): Promise<void> {
		const todayKey = dateKey(now)
		await this.prisma.tgAccount
			.updateMany({
				where: {
					id: { in: ids },
					OR: [{ dailyCapDate: null }, { dailyCapDate: { not: todayKey } }],
				},
				data: { dailyCap: cap, dailyCapDate: todayKey },
			})
			.catch(() => undefined)
	}

	/**
	 * То же разрешение, но сразу на пачку аккаунтов.
	 *
	 * Поштучный расчёт стоит пяти запросов на аккаунт: на полусотне это триста
	 * последовательных обращений к базе на одну загрузку списка. Здесь счётчики
	 * снимаются агрегатами по всему набору, а сам расчёт идёт в памяти теми же
	 * чистыми функциями — результат по аккаунту обязан совпадать с одиночным.
	 *
	 * Утверждение нормы тоже общее: по одному updateMany на каждое значение
	 * нормы. Значений в пуле единицы, аккаунтов десятки.
	 */
	private async allowancesFor(
		accounts: any[],
		dayIndex: number,
		opts?: { settle?: boolean },
	): Promise<Map<string, Allowance>> {
		const out = new Map<string, Allowance>()
		if (!accounts.length) return out

		const now = new Date()
		const counters = await this.allowanceCounters(accounts.map(a => a.id), now)
		const settle = new Map<number, string[]>()
		for (const a of accounts) {
			const { allowance, settleCap } = this.allowanceFrom(a, dayIndex, counters.get(a.id)!, now)
			out.set(a.id, allowance)
			if (settleCap !== null) settle.set(settleCap, [...(settle.get(settleCap) ?? []), a.id])
		}

		// Читающий экран норму не утверждает. Иначе судьбу дня решал бы тот, кто
		// первым открыл админку: заглянул в полночь — у всего пула зафиксирован
		// один потолок, заглянул утром — другой. Утверждают те, кто реально
		// работает аккаунтом: тик рассылки и воркер прогрева.
		if (opts?.settle === false) return out

		await Promise.all([...settle].map(([cap, ids]) => this.settleCaps(ids, cap, now)))
		return out
	}

	/**
	 * Счётчики, из которых считается разрешение, — на любое число аккаунтов.
	 *
	 * Окна времени общие для всех: сутки по Москве — дневной расход, двое суток
	 * — автоснижение. Двое, а не одни: срок действия задаёт само окно — отказ
	 * стареет, выпадает из него, и норма возвращается без таймеров и без
	 * состояния в базе (см. throttleFor).
	 *
	 * Время передаётся снаружи: на пачке все аккаунты должны мериться одной и
	 * той же полуночью, иначе соседние строки списка считались бы по разным
	 * суткам.
	 */
	private async allowanceCounters(ids: string[], now: Date): Promise<Map<string, AllowanceCounters>> {
		const out = new Map<string, AllowanceCounters>()
		for (const id of ids) {
			out.set(id, { joined: 0, spentOnOutreach: 0, sent48h: 0, blockedAt: [], peerFloodAt: null })
		}
		if (!ids.length) return out

		const midnight = mskAt(now, 0, 0)
		const from48 = new Date(now.getTime() - 48 * 3600_000)
		const [joins, firstTouches, secondTouches, sent48h, refusals, peerFloods] = await Promise.all([
			this.prisma.tgWarmupAction.groupBy({
				by: ['accountId'],
				where: { accountId: { in: ids }, kind: 'join', ok: true },
				_count: { _all: true },
			}),
			// Первое и второе касание считаются раздельно, а складываются уже
			// здесь: у рассылки и прогрева бюджет исходящих общий, иначе каждый
			// отсчитывал бы свою норму и в сумме выходило бы вдвое больше, чем
			// считает безопасным любой из них.
			this.prisma.tgRecipient.groupBy({
				by: ['accountId'],
				where: { accountId: { in: ids }, sentAt: { gte: midnight } },
				_count: { _all: true },
			}),
			this.prisma.tgRecipient.groupBy({
				by: ['accountId'],
				where: { accountId: { in: ids }, secondSentAt: { gte: midnight } },
				_count: { _all: true },
			}),
			this.prisma.tgRecipient.groupBy({
				by: ['accountId'],
				where: { accountId: { in: ids }, sentAt: { gte: from48 } },
				_count: { _all: true },
			}),
			// Отказы считаем по стоп-листу: туда попадают и те, кто закрылся, и
			// те, кто прямо попросил не писать. Строка адресата к этому моменту
			// может быть уже удалена вместе с кампанией, а отказ — остаться.
			this.prisma.tgStopList.findMany({
				where: { accountId: { in: ids }, createdAt: { gte: from48 }, source: { in: ['blocked', 'opt-out'] } },
				select: { accountId: true, createdAt: true },
			}),
			// Нужен только последний PEER_FLOOD — _max по группе отвечает на это
			// одним запросом вместо findFirst на каждый аккаунт.
			this.prisma.tgAccountEvent.groupBy({
				by: ['accountId'],
				where: { accountId: { in: ids }, kind: 'peer-flood' },
				_max: { createdAt: true },
			}),
		])

		for (const r of joins) out.get(r.accountId)!.joined = r._count._all
		for (const r of firstTouches) out.get(r.accountId!)!.spentOnOutreach += r._count._all
		for (const r of secondTouches) out.get(r.accountId!)!.spentOnOutreach += r._count._all
		for (const r of sent48h) out.get(r.accountId!)!.sent48h = r._count._all
		for (const r of refusals) out.get(r.accountId!)!.blockedAt.push(r.createdAt)
		for (const r of peerFloods) out.get(r.accountId)!.peerFloodAt = r._max.createdAt
		return out
	}

	/**
	 * Собственно расчёт разрешения — ни одного обращения к базе.
	 *
	 * Вынесен отдельно, чтобы одиночный вызов и список считали одно и то же:
	 * расхождение между «нормой в карточке» и «нормой в списке» — ровно тот
	 * разнобой, из-за которого экран перестают читать.
	 *
	 * Норму, которую надо утвердить в базе, метод не пишет, а возвращает:
	 * одиночный вызов пишет её UPDATE, список — одним updateMany на группу.
	 */
	private allowanceFrom(
		account: any,
		dayIndex: number,
		counters: AllowanceCounters,
		now: Date,
	): { allowance: Allowance; settleCap: number | null } {
		const probe: any = account.probe ?? {}
		const filled = account.probe
			? ((probe.hasFirstName ? 1 : 0) + (probe.hasLastName ? 1 : 0) + (probe.hasUsername ? 1 : 0) +
				(probe.hasBio ? 1 : 0) + ((probe.photoCount ?? 0) > 0 ? 1 : 0)) / 5
			// Анкеты нет — считаем только по тому, что пришло из json поставщика.
			: ((account.firstName ? 1 : 0) + (account.lastName ? 1 : 0) + (account.username ? 1 : 0)) / 5

		const throttle = throttleFor({
			now,
			peerFloodAt: counters.peerFloodAt,
			sent48h: counters.sent48h,
			blockedAt: counters.blockedAt,
		})

		/*
		 * Норма на сутки утверждается ОДИН раз за день и дальше не
		 * пересматривается. Иначе ступень роста мерилась бы сама от себя:
		 * утром три, к обеду четыре, к вечеру пять — и за сутки набежало бы
		 * ровно то удвоение, от которого ступень и защищает.
		 */
		const todayKey = dateKey(now)
		const settled = account.dailyCapDate === todayKey
		/*
		 * Ноль потолком НЕ считается — ни утверждённый сегодня, ни вчерашний.
		 *
		 * Иначе получалось так: в пять минут первого кто-то открыл экран, а у
		 * аккаунта висел временный спам-блок — норма честно посчиталась нулём и
		 * этим нулём утвердилась на сутки. В три часа ночи @SpamBot снял
		 * ограничение, бот написал «снова в рассылке» — а писать аккаунт не мог
		 * до следующей полуночи, потому что потолок дня был нулевой.
		 *
		 * Ступень роста существует, чтобы не пускать норму вверх скачком.
		 * Держать её внизу — дело автоснижения и спам-блока, и они посчитаются
		 * заново при следующем же вызове.
		 */
		const capCeiling = settled ? (account.dailyCap || null) : growthCeiling(account.dailyCap)

		const allow = outgoingAllowance({
			dayIndex,
			ageDays: account.registeredAt
				? Math.floor((Date.now() - account.registeredAt.getTime()) / DAY_MS)
				: null,
			daysManaged: Math.max(0, Math.floor((Date.now() - account.createdAt.getTime()) / DAY_MS)),
			actionsTotal: account.actionsTotal ?? 0,
			dialogs: probe.dialogs ?? 0,
			channels: Math.max(probe.channels ?? 0, counters.joined),
			profileFilled: filled,
			spamBlock: probe.spamBlock ?? 'unknown',
			floodWaits: account.floodWaits ?? 0,
			peerFloods: account.peerFloods ?? 0,
			throttle,
			capCeiling,
		})

		/*
		 * Норму на сегодня утверждаем только при dayIndex = 0, то есть при
		 * расчёте «сколько этому аккаунту можно вообще», каким его спрашивают
		 * рассылка и фон. Расчёт с днём прогрева — про разгон внутри прогрева:
		 * на первых сутках он честно отвечает «ноль, только читаем», и
		 * утверждать этот ноль как норму дня нельзя. Иначе всё решал бы порядок
		 * вызовов: успел прийти прогрев — рассылка на сегодня закрыта, успела
		 * рассылка — открыта.
		 *
		 * Запись одна на аккаунт в сутки: дальше dailyCapDate совпадает с
		 * сегодняшним днём и сюда мы не заходим.
		 *
		 * Ноль не утверждаем вовсе: «сегодня нельзя» — это ответ спам-блока или
		 * автоснижения, и он пересчитывается сам. Записанный нулём потолок
		 * пережил бы снятие ограничения и продержал бы аккаунт молчащим до
		 * следующих суток.
		 *
		 * Запоминаем здоровую норму (baseMessages), а не итоговую: иначе
		 * завтрашняя ступень мерилась бы от прижатого автоснижением числа и
		 * возврат растягивался бы на лишние сутки после того, как повод
		 * снижать уже прошёл.
		 */
		const settleCap = !settled && dayIndex === 0 && allow.baseMessages > 0 ? allow.baseMessages : null

		const spentOnOutreach = counters.spentOnOutreach
		if (!spentOnOutreach) return { allowance: allow, settleCap }

		const left = Math.max(0, allow.maxMessagesPerDay - spentOnOutreach)
		return {
			allowance: {
				...allow,
				maxMessagesPerDay: left,
				// Вступления и реакции не режем: они не исходящие сообщения и в
				// спам-лимит не идут, а историю подписок и присутствия аккаунту
				// набирать всё равно надо — особенно когда норма сообщений ушла
				// на рассылку и прогреву писать уже нечем.
				allowOutgoing: allow.maxJoinsPerDay > 0 || left > 0 || allow.maxReactionsPerDay > 0,
				notes: [
					...allow.notes,
					`Из нормы исходящих ${spentOnOutreach} уже ушло на рассылку, на прогрев осталось ${left}`,
				],
			},
			settleCap,
		}
	}

	/** Сколько вступлений, сообщений и реакций уже сделано сегодня — для дневных квот. */
	private async usedToday(accountId: string): Promise<{ joins: number; messages: number; reactions: number }> {
		const from = mskAt(new Date(), 0, 0)
		const rows = await this.prisma.tgWarmupAction.findMany({
			where: { accountId, createdAt: { gte: from }, ok: true },
			select: { kind: true },
		})
		return {
			joins: rows.filter(r => r.kind === 'join').length,
			// Переписка со своими — единственное исходящее СООБЩЕНИЕ в прогреве,
			// и норма у него общая с рассылкой.
			messages: rows.filter(r => r.kind === 'peer-chat').length,
			// Реакции, голоса, пересылки: своя квота, автоснижением не режется.
			reactions: rows.filter(r => REACTION_KINDS.has(r.kind)).length,
		}
	}

	/**
	 * Кому писать из своих. Исходящая история нужна для оценки, но писать
	 * незнакомым — прямой путь к PEER_FLOOD, поэтому собеседник берётся из
	 * собственного пула. Если аккаунт в пуле один, действие просто не выпадает.
	 */
	private async pickPeer(accountId: string): Promise<string | null> {
		const rows = await this.prisma.tgAccount.findMany({
			where: {
				id: { not: accountId },
				username: { not: null },
				status: { in: ['READY', 'WARMING'] },
			},
			select: { username: true },
			orderBy: { id: 'asc' },
			take: 20,
		})
		if (!rows.length) return null
		const rnd = makeRng(accountSeed(accountId))
		return rows[Math.floor(rnd() * rows.length)].username
	}

	/**
	 * Момент следующего пробуждения. Сегодня, если окно ещё не закрылось и
	 * назначенная минута впереди; иначе завтра.
	 */
	private nextStart(accountId: string, from: Date, w: Window): Date {
		for (let dayShift = 0; dayShift < 2; dayShift++) {
			const day = new Date(from.getTime() + dayShift * DAY_MS)
			const minute = dailyStartMinute(accountId, dateKey(day), [w])
			const at = mskAt(day, 0, 0, minute)
			if (at > from) return at
		}
		return new Date(from.getTime() + DAY_MS)
	}
}
