import { Api, TelegramClient } from 'teleproto'
import { StringSession } from 'teleproto/sessions'
import { LogLevel, Logger } from 'teleproto/extensions/Logger'
import * as Errors from 'teleproto/errors'
import bigInt from 'big-integer'
import type { Fingerprint } from './session-import'
import type { AccountProbe } from './warmup-score'
import { estimateRegistration } from './account-age'

/**
 * Слой работы с Telegram по MTProto: подключение через прокси, снятие анкеты
 * аккаунта и классификация ошибок.
 *
 * Почему teleproto, а не gramjs: репозиторий gramjs заархивирован 14.07.2026,
 * последний релиз в npm — февраль 2025 на слое TL 198, и в README висит
 * указание переезжать на этот форк. teleproto — тот же API, слой 229, без
 * нативных зависимостей (это важно: образ собирается на alpine/musl, где
 * пребилдов для bufferutil нет).
 *
 * ЧЕСТНОЕ ОГРАНИЧЕНИЕ. Всё в этом файле проверено на типах, на конструкторах
 * TL-запросов и на поведении с мёртвым прокси. Реального обмена с Telegram
 * не было: для этого нужен живой аккаунт и живой прокси. Первый аккаунт надо
 * прогнать через «Проверить» и посмотреть, что вернётся, прежде чем ставить
 * прогрев на весь пул.
 */

// ── настройки соединения ─────────────────────────────────────────────────────

// Конечное число попыток. По умолчанию библиотека ставит Infinity, и на
// мёртвом прокси connect() не возвращает управление никогда — воркер молча
// зависает, а в интерфейсе аккаунт выглядит «в работе».
const CONNECTION_RETRIES = 2
// Таймаут TCP-коннекта к дата-центру, секунды.
const CONNECT_TIMEOUT_SEC = 12
// Свой предохранитель поверх библиотечного: любой вызов обязан завершиться.
const CALL_TIMEOUT_MS = 45_000

export type ProxySettings = {
	host: string
	port: number
	username?: string | null
	password?: string | null
	kind: string
}

export type ClientOptions = {
	/** Расшифрованная строковая сессия. */
	session: string
	apiId: number
	apiHash: string
	fingerprint: Fingerprint
	proxy?: ProxySettings | null
}

// ── классификация ошибок ─────────────────────────────────────────────────────

export type FailureKind =
	| 'proxy' // прокси не пустил
	| 'unauthorized' // сессия больше не действует
	| 'banned' // аккаунт заблокирован
	| 'frozen' // аккаунт заморожен
	| 'flood' // FLOOD_WAIT, надо ждать
	| 'peerFlood' // спам-лимит на исходящие
	| 'timeout'
	| 'other'

export type Failure = { kind: FailureKind; message: string; seconds?: number }

/**
 * Разбор ошибки в понятную причину.
 *
 * Опираемся на instanceof, а не на текст: у части классов errorMessage равен
 * просто «FLOOD». И два подвоха, которые легко пропустить:
 *   - SlowModeWaitError НЕ наследует FloodWaitError;
 *   - PeerFloodError НЕ наследует FloodError и приходит с кодом 400.
 * Наивная ветка «если flood — спать seconds секунд» на них даёт sleep(NaN).
 */
export function classifyError(e: any): Failure {
	const message = String(e?.errorMessage || e?.message || e || 'неизвестная ошибка')

	if (e instanceof Errors.FloodWaitError || e instanceof Errors.SlowModeWaitError) {
		const seconds = Number(e.seconds)
		return { kind: 'flood', message, seconds: Number.isFinite(seconds) ? seconds : undefined }
	}
	if (e instanceof Errors.PeerFloodError) return { kind: 'peerFlood', message }
	if (e instanceof Errors.FrozenMethodInvalidError || /FROZEN/i.test(message)) {
		return { kind: 'frozen', message }
	}
	if (
		e instanceof Errors.UserDeactivatedBanError ||
		e instanceof Errors.UserDeactivatedError ||
		e instanceof Errors.PhoneNumberBannedError
	) {
		return { kind: 'banned', message }
	}
	if (
		e instanceof Errors.AuthKeyUnregisteredError ||
		e instanceof Errors.SessionRevokedError ||
		e instanceof Errors.SessionExpiredError ||
		e instanceof Errors.AuthKeyDuplicatedError ||
		e instanceof Errors.UnauthorizedError ||
		/AUTH_KEY_UNREGISTERED|SESSION_REVOKED|SESSION_EXPIRED/i.test(message)
	) {
		return { kind: 'unauthorized', message }
	}
	if (/socks|proxy|ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH|ETIMEDOUT|getaddrinfo/i.test(message)) {
		return { kind: 'proxy', message }
	}
	if (/timeout|таймаут/i.test(message)) return { kind: 'timeout', message }
	return { kind: 'other', message }
}

export class TgError extends Error {
	constructor(public failure: Failure) {
		super(failure.message)
		this.name = 'TgError'
	}
}

// ── подключение ──────────────────────────────────────────────────────────────

/** Предохранитель: обещание, которое обязано завершиться за отведённое время. */
function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`Таймаут: ${what} не ответил за ${ms} мс`)), ms)
		p.then(
			v => {
				clearTimeout(timer)
				resolve(v)
			},
			e => {
				clearTimeout(timer)
				reject(e)
			},
		)
	})
}

function buildClient(o: ClientOptions): TelegramClient {
	return new TelegramClient(new StringSession(o.session), o.apiId, o.apiHash, {
		// Фингерпринт уходит на сервер при каждом подключении. Если не задать
		// эти поля, библиотека подставит os.type() и os.release(), и аккаунт
		// представится Linux-контейнером.
		deviceModel: o.fingerprint.deviceModel,
		systemVersion: o.fingerprint.systemVersion,
		appVersion: o.fingerprint.appVersion,
		langCode: o.fingerprint.langCode,
		systemLangCode: o.fingerprint.systemLangCode,
		proxy: o.proxy
			? {
					ip: o.proxy.host,
					port: o.proxy.port,
					socksType: o.proxy.kind === 'socks4' ? 4 : 5,
					username: o.proxy.username || undefined,
					password: o.proxy.password || undefined,
					timeout: CONNECT_TIMEOUT_SEC,
				}
			: undefined,
		connectionRetries: CONNECTION_RETRIES,
		retryDelay: 1500,
		timeout: CONNECT_TIMEOUT_SEC,
		// Никакого автосна на FLOOD_WAIT: решение «ждать или отложить на завтра»
		// принимает планировщик, а не библиотека внутри вызова.
		floodSleepThreshold: 0,
		autoReconnect: false,
		// Библиотека по умолчанию сыплет в stdout на каждый коннект.
		baseLogger: new Logger(LogLevel.NONE),
	})
}

/**
 * Подключиться, выполнить работу, гарантированно отсоединиться.
 *
 * destroy(), а не disconnect(): второй не останавливает цикл обновлений, и
 * процесс не завершается, а соединения копятся.
 *
 * Если сессия обновилась (Telegram переселил аккаунт в другой дата-центр),
 * возвращаем новую строку — вызывающий обязан её сохранить, иначе следующий
 * запуск начнётся с устаревшего адреса.
 */
export async function withClient<T>(
	o: ClientOptions,
	fn: (client: TelegramClient) => Promise<T>,
): Promise<{ result: T; session: string }> {
	const client = buildClient(o)
	try {
		await withTimeout(client.connect(), (CONNECT_TIMEOUT_SEC + 8) * 1000 * CONNECTION_RETRIES, 'подключение')
		const result = await fn(client)
		return { result, session: (client.session as StringSession).save() }
	} catch (e) {
		throw new TgError(classifyError(e))
	} finally {
		await client.destroy().catch(() => {})
	}
}

/** Один вызов к Telegram с таймаутом и разбором ошибки. */
export async function call<T>(client: TelegramClient, what: string, fn: () => Promise<T>): Promise<T> {
	try {
		return await withTimeout(fn(), CALL_TIMEOUT_MS, what)
	} catch (e) {
		throw new TgError(classifyError(e))
	}
}

/** То же, но неудача не роняет всю анкету: часть методов заблокирована у части аккаунтов. */
async function soft<T>(client: TelegramClient, what: string, fn: () => Promise<T>): Promise<T | null> {
	try {
		return await withTimeout(fn(), CALL_TIMEOUT_MS, what)
	} catch {
		return null
	}
}

// ── анкета аккаунта ──────────────────────────────────────────────────────────

export type ProbeResult = {
	probe: AccountProbe
	self: {
		userId: string
		username: string | null
		firstName: string | null
		lastName: string | null
		phone: string | null
	}
	/** Аватар как data-URI. null, если фото нет или не скачалось. */
	avatar: string | null
	registeredAt: Date | null
}

const DAY = 86400000

/**
 * Снять анкету: всё, из чего считается оценка.
 *
 * Порядок вызовов не случайный — сначала то, что делает любой живой клиент при
 * запуске (кто я, мои диалоги), потом настройки. Пачка одинаковых служебных
 * запросов подряд у свежего аккаунта — сама по себе странный след.
 *
 * spamBlock здесь всегда 'unknown': единственный способ его узнать — написать
 * боту @SpamBot, а это исходящее сообщение. На свежем аккаунте оно вреднее,
 * чем незнание, поэтому проверка вынесена в отдельную ручку и делается руками.
 */
export async function probeAccount(client: TelegramClient): Promise<ProbeResult> {
	const me: any = await call(client, 'getMe', () => client.getMe())
	const userId = String(me?.id ?? '')

	const full: any = await soft(client, 'getFullUser', () =>
		client.invoke(new Api.users.GetFullUser({ id: new Api.InputUserSelf() })),
	)
	const auths: any = await soft(client, 'getAuthorizations', () =>
		client.invoke(new Api.account.GetAuthorizations()),
	)
	const dialogs: any = await soft(client, 'getDialogs', () => client.getDialogs({ limit: 100 }))
	const contacts: any = await soft(client, 'getContacts', () =>
		client.invoke(new Api.contacts.GetContacts({ hash: bigInt(0) })),
	)
	const password: any = await soft(client, 'getPassword', () => client.invoke(new Api.account.GetPassword()))
	const photos: any = await soft(client, 'getUserPhotos', () =>
		client.invoke(
			new Api.photos.GetUserPhotos({
				userId: new Api.InputUserSelf(),
				offset: 0,
				maxId: bigInt(0),
				limit: 10,
			}),
		),
	)

	const list: any[] = auths?.authorizations ?? []
	// Самая старая живая сессия — нижняя граница возраста аккаунта, независимая
	// от оценки по id. Если аккаунт перезаливали, она будет свежей, и это
	// заметно расходится с возрастом по id — ровно тот случай, который надо
	// показать в подсказках.
	const oldest = list.length
		? Math.min(...list.map(a => Number(a.dateCreated) * 1000).filter(n => Number.isFinite(n) && n > 0))
		: null

	// Маленькое фото, не большое: в списке оно показывается кружком 36 пикселей,
	// и тянуть ради этого полный размер незачем. Отсутствие фото — не ошибка.
	let avatar: string | null = null
	const photo = await soft(client, 'downloadProfilePhoto', () =>
		client.downloadProfilePhoto('me', { isBig: false }),
	)
	if (photo && Buffer.isBuffer(photo) && photo.length > 0 && photo.length < 400_000) {
		avatar = `data:image/jpeg;base64,${photo.toString('base64')}`
	}

	const est = userId ? estimateRegistration(userId) : null

	const dialogList: any[] = Array.isArray(dialogs) ? dialogs : (dialogs?.dialogs ?? [])
	const channels = dialogList.filter(d => d?.isChannel || d?.entity?.className === 'Channel').length

	/*
	 * Своя история аккаунта — та, что была ДО нас.
	 *
	 * Без неё оценка врала в обе стороны: купленный аккаунт с двумя годами
	 * переписки выглядел так же пусто, как вчерашняя пустышка, потому что в
	 * нашем журнале у обоих ноль. А это ровно тот признак, за который платят.
	 *
	 * Считаем по номеру последнего сообщения в диалоге: в личной переписке
	 * номера идут подряд с единицы, так что topMessage — это и есть, сколько
	 * сообщений там всего было. Для каналов так нельзя (там своя нумерация на
	 * весь канал, а не на нашу с ним переписку), поэтому берём только личные.
	 * Оценка грубая, но отличает «переписывался годами» от «чистый лист».
	 */
	let historyMessages = 0
	let oldestDialogDays: number | null = null
	for (const d of dialogList) {
		if (!d?.isUser) continue
		const top = Number(d?.dialog?.topMessage ?? 0)
		// Отсекаем нелепые значения: битый диалог не должен раздувать сумму.
		if (Number.isFinite(top) && top > 0 && top < 500_000) historyMessages += top
		const date = Number(d?.message?.date ?? 0)
		if (date > 0) {
			const days = Math.floor((Date.now() / 1000 - date) / 86400)
			if (oldestDialogDays == null || days > oldestDialogDays) oldestDialogDays = days
		}
	}

	const probe: AccountProbe = {
		ageDays: est ? est.ageDays : null,
		oldestSessionDays: oldest ? Math.floor((Date.now() - oldest) / DAY) : null,
		hasFirstName: !!me?.firstName,
		hasLastName: !!me?.lastName,
		hasUsername: !!me?.username,
		hasBio: !!full?.fullUser?.about,
		photoCount: Number(photos?.count ?? photos?.photos?.length ?? 0) || 0,
		activeSessions: list.length,
		premium: !!me?.premium,
		twoFactor: !!password?.hasPassword,
		dialogs: dialogList.length,
		channels,
		historyMessages,
		oldestDialogDays,
		contacts: Number(contacts?.contacts?.length ?? contacts?.savedCount ?? 0) || 0,
		// Точного счётчика исходящих Telegram не отдаёт. Здесь ноль, а реальное
		// значение подставляет сервис: он знает наш собственный журнал действий.
		outgoingTotal: 0,
		spamBlock: 'unknown',
		frozen: false,
		banned: false,
		fingerprintChanges: 0,
	}

	return {
		probe,
		avatar,
		self: {
			userId,
			username: me?.username ?? null,
			firstName: me?.firstName ?? null,
			lastName: me?.lastName ?? null,
			phone: me?.phone ?? null,
		},
		registeredAt: est ? est.date : null,
	}
}
