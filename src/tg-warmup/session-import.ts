import AdmZip from 'adm-zip'
import {
	Tdata,
	convertFromTdata,
	convertFromTelethonSession,
	convertToGramjsSession,
	parseGramjsSession,
	serializeGramjsSession,
} from '@mtcute/convert'
import { readSqliteTable } from './sqlite-lite'
import { accountSeed, makeRng } from './warmup-plan'

/**
 * Приём аккаунтов: превращаем то, что дал поставщик, в одну строковую сессию.
 *
 * Поддержано четыре входа — это всё, в чём аккаунты реально ходят по рынку:
 *   1. файл .session (Telethon, внутри SQLite);
 *   2. строковая сессия Telethon;
 *   3. строковая сессия GramJS/Telethon-string (наш внутренний формат);
 *   4. tdata Telegram Desktop, упакованная в zip.
 *
 * ВАЖНО про tdata: она разбирается ЦЕЛИКОМ В ПАМЯТИ. Файловая система для
 * @mtcute/convert — это интерфейс из четырёх методов, и мы подсовываем свою,
 * поверх содержимого архива. Это не оптимизация: у бэкенда в контейнере нет
 * тома под запись, деплой идёт пересборкой образа, и всё, что записано на
 * диск, теряется (живой пример — metrika_token.json). Плюс ключи аккаунтов
 * не должны оседать на диске даже временно.
 */

export type ImportedAccount = {
	/** Строковая сессия в формате GramJS — то, что кладём в базу зашифрованным. */
	session: string
	dcId: number
	/** Индекс аккаунта внутри tdata; для остальных входов 0. */
	index: number
	userId?: string
}

/** Реквизиты и фингерпринт из json-файла, который часто идёт в комплекте. */
export type CompanionMeta = {
	apiId?: number
	apiHash?: string
	phone?: string
	username?: string
	firstName?: string
	lastName?: string
	userId?: string
	deviceModel?: string
	systemVersion?: string
	appVersion?: string
	langCode?: string
	systemLangCode?: string
	twoFactor?: string
	registeredAt?: Date
}

// ── .session (SQLite) ────────────────────────────────────────────────────────

/**
 * Достаём ключ из файла Telethon. dc_id объявлен как INTEGER PRIMARY KEY,
 * поэтому в самой записи лежит NULL, а номер дата-центра — в rowid.
 */
export function importFromSessionFile(file: Buffer): ImportedAccount {
	const rows = readSqliteTable(file, 'sessions')
	if (!rows.length) throw new Error('В файле .session нет сохранённой сессии — аккаунт не авторизован')

	// Если строк несколько, берём ту, где есть ключ.
	const row = rows.find(r => Buffer.isBuffer(r.values[3]) && (r.values[3] as Buffer).length === 256) ?? rows[0]
	const [, address, port, authKey] = row.values
	if (!Buffer.isBuffer(authKey) || authKey.length !== 256) {
		throw new Error('В файле .session нет ключа авторизации (ожидалось 256 байт)')
	}
	if (typeof address !== 'string' || !address) throw new Error('В файле .session нет адреса дата-центра')

	return {
		session: serializeGramjsSession({
			dcId: row.rowid,
			ipAddress: address,
			ipv6: address.includes(':'),
			port: typeof port === 'number' ? port : 443,
			authKey: new Uint8Array(authKey),
		}),
		dcId: row.rowid,
		index: 0,
	}
}

// ── строковые сессии ─────────────────────────────────────────────────────────

/**
 * Строковая сессия. Telethon и GramJS кодируют одно и то же разными способами,
 * различить их по виду нельзя, поэтому пробуем оба разбора по очереди.
 */
export function importFromStringSession(text: string): ImportedAccount {
	const clean = text.trim()
	if (!clean) throw new Error('Пустая строка сессии')

	// Сначала свой формат: если строка уже наша, лишних преобразований не делаем.
	try {
		const parsed = parseGramjsSession(clean)
		return { session: clean, dcId: parsed.dcId, index: 0 }
	} catch {
		/* не наш формат — пробуем Telethon */
	}
	try {
		const data = convertFromTelethonSession(clean)
		const session = convertToGramjsSession(data)
		return { session, dcId: parseGramjsSession(session).dcId, index: 0 }
	} catch (e: any) {
		throw new Error(`Строка не похожа ни на сессию GramJS, ни на сессию Telethon: ${e?.message ?? e}`)
	}
}

// ── tdata ────────────────────────────────────────────────────────────────────

/** Файловая система в памяти: ровно четыре метода интерфейса @mtcute/convert. */
function memoryFs(files: Map<string, Buffer>) {
	const norm = (p: string) => p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/')
	const miss = (p: string) => Object.assign(new Error(`Нет файла ${p}`), { code: 'ENOENT' })
	return {
		async readFile(p: string) {
			const f = files.get(norm(p))
			if (!f) throw miss(p)
			return f
		},
		async writeFile(p: string, d: Uint8Array) {
			files.set(norm(p), Buffer.from(d))
		},
		async mkdir() {},
		async stat(p: string) {
			const f = files.get(norm(p))
			if (!f) throw miss(p)
			return { size: f.length, lastModified: 0 }
		},
	}
}

/**
 * Разбор архива с tdata. Внутри может быть больше одного аккаунта — Telegram
 * Desktop держит их в одной папке, — поэтому возвращаем список.
 *
 * Папку ищем по key_datas, а не по имени: архивы приходят и как tdata.zip,
 * и как «Аккаунт 79001234567/tdata/...».
 */
export async function importFromTdataZip(zipFile: Buffer, passcode?: string): Promise<ImportedAccount[]> {
	let entries: AdmZip.IZipEntry[]
	try {
		entries = new AdmZip(zipFile).getEntries()
	} catch (e: any) {
		throw new Error(`Не удалось открыть архив: ${e?.message ?? e}`)
	}

	const keyEntry = entries.find(e => !e.isDirectory && /(^|\/)key_datas$/.test(e.entryName))
	if (!keyEntry) {
		throw new Error(
			'В архиве нет файла key_datas — это не tdata. Нужен архив папки tdata из Telegram Desktop.',
		)
	}
	const prefix = keyEntry.entryName.slice(0, keyEntry.entryName.length - 'key_datas'.length)

	const files = new Map<string, Buffer>()
	for (const e of entries) {
		if (e.isDirectory || !e.entryName.startsWith(prefix)) continue
		files.set('tdata/' + e.entryName.slice(prefix.length), e.getData())
	}

	const options = { path: 'tdata', fs: memoryFs(files), passcode }
	let tdata: Tdata
	try {
		tdata = await Tdata.open(options)
	} catch (e: any) {
		const msg = String(e?.message ?? e)
		if (/passcode|decrypt/i.test(msg)) {
			throw new Error('tdata закрыта локальным паролем. Введите его в поле «Локальный пароль».')
		}
		throw new Error(`tdata не открылась: ${msg}`)
	}

	// order перечисляет занятые слоты. Пустой список бывает у одиночного
	// аккаунта в нулевом слоте — тогда берём его напрямую.
	const slots = tdata.keyData.order?.length ? tdata.keyData.order : [0]
	const out: ImportedAccount[] = []
	const problems: string[] = []
	for (const idx of slots) {
		try {
			const auth = await tdata.readMtpAuthorization(idx)
			const data = await convertFromTdata(tdata, idx)
			out.push({
				session: convertToGramjsSession(data),
				dcId: auth.mainDcId,
				index: idx,
				userId: String(auth.userId),
			})
		} catch (e: any) {
			problems.push(`слот ${idx}: ${e?.message ?? e}`)
		}
	}
	if (!out.length) throw new Error(`Из tdata не удалось достать ни одного аккаунта (${problems.join('; ')})`)
	return out
}

// ── сопроводительный json ────────────────────────────────────────────────────

/**
 * Json, который поставщики кладут рядом с сессией. Единого стандарта нет,
 * поэтому каждое поле ищется под несколькими именами, а чего нет — того нет.
 */
export function parseCompanionJson(text: string): CompanionMeta {
	let raw: any
	try {
		raw = JSON.parse(text)
	} catch (e: any) {
		throw new Error(`Файл json не разобрался: ${e?.message ?? e}`)
	}
	if (!raw || typeof raw !== 'object') throw new Error('В json ожидался объект')

	const pick = (...names: string[]) => {
		for (const n of names) {
			const v = raw[n]
			if (v !== undefined && v !== null && v !== '') return v
		}
		return undefined
	}
	const str = (v: any) => (v === undefined ? undefined : String(v))
	const num = (v: any) => {
		const n = Number(v)
		return Number.isFinite(n) ? n : undefined
	}

	// Дата регистрации иногда приходит секундами, иногда миллисекундами,
	// иногда строкой. Различаем по порядку величины.
	const regRaw = pick('register_time', 'registerTime', 'registration_date', 'created')
	let registeredAt: Date | undefined
	if (regRaw !== undefined) {
		const n = Number(regRaw)
		const d = Number.isFinite(n) ? new Date(n > 1e12 ? n : n * 1000) : new Date(String(regRaw))
		if (!Number.isNaN(d.getTime())) registeredAt = d
	}

	return {
		apiId: num(pick('app_id', 'api_id', 'appId', 'apiId')),
		apiHash: str(pick('app_hash', 'api_hash', 'appHash', 'apiHash')),
		phone: str(pick('phone', 'phone_number')),
		username: str(pick('username'))?.replace(/^@/, ''),
		firstName: str(pick('first_name', 'firstName')),
		lastName: str(pick('last_name', 'lastName')),
		userId: str(pick('user_id', 'id', 'userId')),
		deviceModel: str(pick('device', 'device_model', 'deviceModel')),
		systemVersion: str(pick('sdk', 'system_version', 'systemVersion')),
		appVersion: str(pick('app_version', 'appVersion')),
		langCode: str(pick('lang_code', 'lang_pack', 'langCode')),
		systemLangCode: str(pick('system_lang_code', 'system_lang_pack', 'systemLangCode')),
		twoFactor: str(pick('twoFA', 'two_fa', 'password', 'twofa')),
		registeredAt,
	}
}

// ── фингерпринт ──────────────────────────────────────────────────────────────

/**
 * Пять полей, которые клиент отправляет серверу при КАЖДОМ подключении.
 *
 * Библиотека их не сохраняет: в строковой сессии лежат только дата-центр и
 * ключ. Значит источник правды — наша база, иначе после перезапуска сервиса
 * аккаунт представится Linux-контейнером (в дефолтах пусто, и подставляются
 * os.type() и os.release()), а смена устройства у живущего аккаунта — сигнал
 * заметнее, чем любая активность.
 */
export type Fingerprint = {
	deviceModel: string
	systemVersion: string
	appVersion: string
	langCode: string
	systemLangCode: string
}

// Реальные связки «устройство — система — версия клиента». Смешивать нельзя:
// Telegram Desktop 5.x не бывает на «iPhone 13», и такая пара сама по себе метка.
const DESKTOP_PROFILES: Fingerprint[] = [
	{ deviceModel: 'MacBook Pro', systemVersion: 'macOS 15.3', appVersion: '5.10.4', langCode: 'ru', systemLangCode: 'ru-RU' },
	{ deviceModel: 'iMac', systemVersion: 'macOS 15.2', appVersion: '5.9.1', langCode: 'ru', systemLangCode: 'ru-RU' },
	{ deviceModel: 'PC 64bit', systemVersion: 'Windows 11', appVersion: '5.10.4', langCode: 'ru', systemLangCode: 'ru-RU' },
	{ deviceModel: 'PC 64bit', systemVersion: 'Windows 10', appVersion: '5.8.3', langCode: 'ru', systemLangCode: 'ru-RU' },
	{ deviceModel: 'Desktop', systemVersion: 'Windows 11', appVersion: '5.9.0', langCode: 'ru', systemLangCode: 'ru-RU' },
]

/**
 * Постоянный фингерпринт для аккаунта. Считается от id, поэтому один и тот же
 * аккаунт всегда получает один и тот же профиль, а разные аккаунты — разные.
 */
export function defaultFingerprint(accountKey: string): Fingerprint {
	const rnd = makeRng(accountSeed('fp:' + accountKey))
	return { ...DESKTOP_PROFILES[Math.floor(rnd() * DESKTOP_PROFILES.length) % DESKTOP_PROFILES.length] }
}

/** json перекрывает автоподбор по каждому полю отдельно: что дали, то и берём. */
export function mergeFingerprint(base: Fingerprint, meta?: CompanionMeta): Fingerprint {
	if (!meta) return base
	return {
		deviceModel: meta.deviceModel || base.deviceModel,
		systemVersion: meta.systemVersion || base.systemVersion,
		appVersion: meta.appVersion || base.appVersion,
		langCode: meta.langCode || base.langCode,
		systemLangCode: meta.systemLangCode || base.systemLangCode,
	}
}
