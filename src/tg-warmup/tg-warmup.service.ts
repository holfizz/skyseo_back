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
import { classifyError, probeAccount, TgError, withClient, type ProxySettings } from './tg-client'
import { askStatus, pressButton, sendText } from './spam-bot'
import { DEFAULT_CHANNELS, OUTGOING, runAction, type ActionKind } from './warmup-actions'
import {
	accountSeed, dailyStartMinute, makeRng, outgoingAllowance, planDay,
	type Allowance, type Session, type Window,
} from './warmup-plan'
import { scoreAccount, type AccountOrigin, type AccountTelemetry, type ScoreResult } from './warmup-score'
import { estimateRegistration } from './account-age'

const DAY_MS = 86400000
const KEY_CHANNELS = 'tg_warmup_channels'
const KEY_API_ID = 'tg_warmup_api_id'
const KEY_API_HASH = 'tg_warmup_api_hash'

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
function displayName(self: { firstName?: string | null; lastName?: string | null; username?: string | null; phone?: string | null }): string | null {
	const name = [self.firstName, self.lastName].filter(Boolean).join(' ').trim()
	if (name) return name
	if (self.username) return '@' + self.username
	if (self.phone) return self.phone
	return null
}

/** Ключ дня в местной шкале сервера: планы строятся по календарным суткам. */
function dateKey(d: Date): string {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
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
	 * Раздать прокси аккаунтам без прокси. Раздаём по одному на аккаунт, пока
	 * свободные есть: соседи по IP — прямой минус в оценке, и чем их меньше,
	 * тем лучше. Если прокси меньше, чем аккаунтов, лишние остаются без него,
	 * и это видно в списке, а не подменяется общим адресом.
	 */
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
	 * вешаем всех на первый попавшийся. Если прокси меньше, чем аккаунтов,
	 * лишние остаются без него, и это видно в списке — молча сажать двоих на
	 * один канал хуже, чем оставить одного без.
	 */
	async assignFromPool(accountIds: string[]) {
		if (!accountIds.length) return { assigned: 0, left: 0 }

		const pool = (
			await this.prisma.tgProxy.findMany({
				where: { alive: true },
				include: { _count: { select: { accounts: true } } },
				orderBy: { createdAt: 'asc' },
			})
		).map(p => ({ id: p.id, load: p._count.accounts }))

		let assigned = 0
		for (const id of accountIds) {
			const target = pool.sort((a, b) => a.load - b.load)[0]
			if (!target) break
			await this.prisma.tgAccount.update({ where: { id }, data: { proxyId: target.id } })
			target.load++
			assigned++
		}
		return { assigned, left: accountIds.length - assigned }
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
			const t = this.telemetryFrom(rowsByAccount.get(a.id) ?? [], a.createdAt, a)
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
		return rows.map(a => {
			const run = a.runs[0]
			const live = scores.get(a.id)
			return {
				id: a.id,
				label: a.label,
				avatar: a.avatar,
				mode: a.mode,
				busyBy: a.busyUntil && a.busyUntil > new Date() ? a.busyBy : null,
				phone: a.phone,
				username: a.username,
				name: [a.firstName, a.lastName].filter(Boolean).join(' ') || null,
				status: a.status,
				score: live ? live.score : a.score,
				warmness: live ? live.warmness.total : a.warmness,
				// Мешает ли что-то работать прямо сейчас — например, отвалившийся
				// прокси. В отличие от вето, балл при этом не обнуляется.
				blocked: live?.blocked ?? null,
				scoredAt: a.scoredAt,
				registeredAt: a.registeredAt,
				ageDays: a.registeredAt ? Math.floor((Date.now() - a.registeredAt.getTime()) / DAY_MS) : null,
				actionsTotal: a.actionsTotal,
				warmupDaysDone: a.warmupDaysDone,
				lastCheckAt: a.lastCheckAt,
				lastError: a.lastError,
				proxy: a.proxy,
				run: run
					? {
							id: run.id, days: run.days, dayIndex: run.dayIndex, status: run.status,
							nextRunAt: run.nextRunAt, doneToday: run.doneToday,
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

		const activeRun = a.runs.find(r => r.status === 'SCHEDULED' || r.status === 'RUNNING')
		// Сразу после запуска dayIndex ещё нулевой: первый день начнётся, когда
		// планировщик разбудит аккаунт. Для карточки это уже первый день, иначе
		// у аккаунта со статусом «Греется» было бы написано «прогрев не запущен».
		const allowance = await this.allowanceFor(a, activeRun ? Math.max(1, activeRun.dayIndex) : 0)
		const spent = await this.usedToday(a.id)

		return {
			// Полный разбор оценки: баллы по блокам, вето, прогретость, советы.
			breakdown: score,
			// Что аккаунту можно СЕГОДНЯ и почему именно столько.
			allowance: { ...allowance, spentJoins: spent.joins, spentMessages: spent.messages },
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
		const pool = input.proxyMode !== 'one' && input.proxyMode !== 'none' && ids.length
			? await this.assignFromPool(ids)
			: null

		return { created: created.length, duplicates, errors, ids, pool }
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
		if (failure.kind === 'peerFlood') patch.peerFloods = { increment: 1 }
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
		if (failure.kind === 'peerFlood') await this.logEvent(accountId, 'peer-flood', failure.message)

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
				// только отдельной ручной проверкой, и терять её незачем.
				spamBlock: ((a.probe as any)?.spamBlock ?? 'unknown') as any,
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
		return this.telemetryFrom(rowsByAccount.get(accountId) ?? [], createdAt, acc)
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
		return { value, outgoing: rows.filter(r => OUTGOING.includes(r.kind as ActionKind) && r.ok).length }
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

			// Статус кладём в анкету: из него считается блок «Ограничения».
			await this.prisma.tgAccount.update({
				where: { id: a.id },
				data: { probe: { ...((a.probe as any) ?? {}), spamBlock: result.state } as any },
			})

			const what =
				action.kind === 'press' ? `нажата кнопка №${action.index + 1}`
					: action.kind === 'text' ? `отправлено: ${action.text}`
						: 'запрошен статус'
			await this.logEvent(
				a.id,
				action.kind === 'status' ? 'spam-check' : action.kind === 'press' ? 'spam-press' : 'spam-appeal',
				`${what}\nОтвет бота (${result.state}): ${result.text || '— пусто —'}`,
			)
			return result
		} catch (e: any) {
			const failure = e instanceof TgError ? e.failure : classifyError(e)
			await this.applyFailure(a.id, failure)
			throw new BadRequestException(`Не получилось: ${failure.message}`)
		} finally {
			await this.releaseAccount(a.id)
		}
	}

	/**
	 * Лента прогрева: что сейчас, что уже было и что запланировано.
	 *
	 * Собирается из трёх источников — плана на сегодня, журнала действий и
	 * состояния прогона. Иначе понять, работает ли прогрев вообще, можно было
	 * только по счётчику действий, а он растёт раз в несколько часов и ничего
	 * не объясняет.
	 */
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
		const nowMin = now.getHours() * 60 + now.getMinutes()
		const sessions: Session[] = Array.isArray(run?.plan) ? (run!.plan as unknown as Session[]) : []
		const doneToday = run?.doneToday ?? 0

		const today = new Date()
		today.setHours(0, 0, 0, 0)
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

	/** Журнал событий аккаунта: баны, разлогины, разговоры со SpamBot. */
	async events(accountId: string, limit = 50) {
		return this.prisma.tgAccountEvent.findMany({
			where: { accountId },
			orderBy: { createdAt: 'desc' },
			take: Math.max(1, Math.min(200, limit)),
		})
	}

	// ── список каналов ───────────────────────────────────────────────────────

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
	async startWarmup(ids: string[], days: number, windowFrom = 9, windowTo = 23) {
		if (!ids?.length) throw new BadRequestException('Не выбрано ни одного аккаунта')
		const d = Math.max(1, Math.min(60, Math.round(days || 7)))
		if (windowTo <= windowFrom) throw new BadRequestException('Окно активности задано наоборот: конец раньше начала')

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
				where: { accountId: a.id, status: { in: ['SCHEDULED', 'RUNNING'] } },
				select: { id: true },
			})
			if (active) {
				skipped.push({ id: a.id, reason: 'прогрев уже идёт' })
				continue
			}
			await this.prisma.tgWarmupRun.create({
				data: {
					accountId: a.id,
					days: d,
					windowFrom, windowTo,
					status: 'SCHEDULED',
					nextRunAt: this.nextStart(a.id, new Date(), { fromHour: windowFrom, toHour: windowTo }),
				},
			})
			await this.prisma.tgAccount.update({ where: { id: a.id }, data: { status: 'WARMING' } })
			started.push(a.id)
		}
		return { started: started.length, skipped }
	}

	async stopWarmup(ids: string[]) {
		await this.prisma.tgWarmupRun.updateMany({
			where: { accountId: { in: ids }, status: { in: ['SCHEDULED', 'RUNNING'] } },
			data: { status: 'STOPPED', finishedAt: new Date() },
		})
		await this.prisma.tgAccount.updateMany({
			where: { id: { in: ids }, status: 'WARMING' },
			data: { status: 'READY' },
		})
		return { ok: true }
	}

	/** Минуты от начала суток для момента времени. */
	private minuteOfDay(d: Date): number {
		return d.getHours() * 60 + d.getMinutes()
	}

	/** Момент времени по минуте суток указанного дня. */
	private atMinute(day: Date, minute: number): Date {
		const at = new Date(day)
		at.setHours(0, 0, 0, 0)
		at.setMinutes(minute)
		return at
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
		// Аккаунт, отведённый только под рассылку, не греем: он и так работает,
		// а два занятия сразу — двойная нагрузка на одну сессию.
		if (account.mode === 'SEND') {
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
			if (dayIndex > run.days) {
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
			})
			plan = built.sessions
			doneToday = 0
			await this.prisma.tgWarmupRun.update({
				where: { id: run.id },
				data: { dayIndex, planDate: today, plan: plan as any, doneToday: 0 },
			})
			// Прошлый день закрыт — засчитываем его аккаунту.
			if (run.planDate) {
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
		const peer = await this.pickPeer(account.id)
		const usedToday = await this.usedToday(account.id)
		const allow = await this.allowanceFor(account, dayIndex)

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
						peer,
						// Ключ пары не зависит от того, кто пишет первым: у обоих
						// аккаунтов должен быть один и тот же разговор.
						chatKey: peer ? [account.username ?? account.id, peer].sort().join(':') : undefined,
						chatIndex: usedToday.messages + dayIndex * 7,
					})
					await this.prisma.tgWarmupAction.create({
						data: {
							accountId: account.id, runId: run.id, dayIndex,
							kind: outcome.kind, ok: true, detail: outcome.detail?.slice(0, 400) ?? null,
						},
					})
					if (outcome.kind === 'join') usedToday.joins++
					if (outcome.kind === 'reaction' || outcome.kind === 'peer-chat') usedToday.messages++
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
	async allowanceFor(account: any, dayIndex: number): Promise<Allowance> {
		const probe: any = account.probe ?? {}
		const joined = await this.prisma.tgWarmupAction.count({
			where: { accountId: account.id, kind: 'join', ok: true },
		})
		const filled = account.probe
			? ((probe.hasFirstName ? 1 : 0) + (probe.hasLastName ? 1 : 0) + (probe.hasUsername ? 1 : 0) +
				(probe.hasBio ? 1 : 0) + ((probe.photoCount ?? 0) > 0 ? 1 : 0)) / 5
			// Анкеты нет — считаем только по тому, что пришло из json поставщика.
			: ((account.firstName ? 1 : 0) + (account.lastName ? 1 : 0) + (account.username ? 1 : 0)) / 5

		// Сколько исходящих аккаунт уже потратил СЕГОДНЯ на рассылку. Если он
		// делает и то и другое, бюджет у него общий: иначе прогрев отсчитывал
		// бы свою норму, рассылка свою, и в сумме выходило бы вдвое больше, чем
		// считает безопасным любой из них.
		const midnight = new Date()
		midnight.setHours(0, 0, 0, 0)
		const [firstTouches, secondTouches] = await Promise.all([
			this.prisma.tgRecipient.count({ where: { accountId: account.id, sentAt: { gte: midnight } } }),
			this.prisma.tgRecipient.count({ where: { accountId: account.id, secondSentAt: { gte: midnight } } }),
		])
		const spentOnOutreach = firstTouches + secondTouches

		const allow = outgoingAllowance({
			dayIndex,
			ageDays: account.registeredAt
				? Math.floor((Date.now() - account.registeredAt.getTime()) / DAY_MS)
				: null,
			daysManaged: Math.max(0, Math.floor((Date.now() - account.createdAt.getTime()) / DAY_MS)),
			actionsTotal: account.actionsTotal ?? 0,
			dialogs: probe.dialogs ?? 0,
			channels: Math.max(probe.channels ?? 0, joined),
			profileFilled: filled,
			spamBlock: probe.spamBlock ?? 'unknown',
			floodWaits: account.floodWaits ?? 0,
			peerFloods: account.peerFloods ?? 0,
		})

		if (!spentOnOutreach) return allow

		const left = Math.max(0, allow.maxMessagesPerDay - spentOnOutreach)
		return {
			...allow,
			maxMessagesPerDay: left,
			// Вступления не режем: они не исходящие сообщения и в спам-лимит
			// не идут, а историю подписок аккаунту набирать всё равно надо.
			allowOutgoing: allow.maxJoinsPerDay > 0 || left > 0,
			notes: [
				...allow.notes,
				`Из нормы исходящих ${spentOnOutreach} уже ушло на рассылку, на прогрев осталось ${left}`,
			],
		}
	}

	/** Сколько вступлений и исходящих уже сделано сегодня — для дневных квот. */
	private async usedToday(accountId: string): Promise<{ joins: number; messages: number }> {
		const from = new Date()
		from.setHours(0, 0, 0, 0)
		const rows = await this.prisma.tgWarmupAction.findMany({
			where: { accountId, createdAt: { gte: from }, ok: true },
			select: { kind: true },
		})
		return {
			joins: rows.filter(r => r.kind === 'join').length,
			messages: rows.filter(r => r.kind === 'reaction' || r.kind === 'peer-chat').length,
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
			const at = new Date(day)
			at.setHours(0, 0, 0, 0)
			at.setMinutes(minute)
			if (at > from) return at
		}
		return new Date(from.getTime() + DAY_MS)
	}
}
