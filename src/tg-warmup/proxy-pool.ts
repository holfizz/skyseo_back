/**
 * Разбор пула прокси. На вход — текст как есть, построчно; на выход — строки
 * для базы плюс внятный список того, что не приняли и почему.
 *
 * Единого формата у продавцов нет, поэтому поддержаны все ходовые записи:
 *   host:port
 *   host:port:логин:пароль
 *   логин:пароль@host:port
 *   socks5://логин:пароль@host:port
 *   tg://proxy?server=host&port=443&secret=...
 *   host:port@логин:пароль
 *
 * Telegram принимает и SOCKS4/SOCKS5, и свой MTProxy. HTTP-прокси библиотека
 * не принимает вовсе, поэтому такие строки отсеиваются здесь, с объяснением.
 */

export type ParsedProxy = {
	host: string
	port: number
	username: string | null
	password: string | null
	secret: string | null
	kind: 'socks5' | 'socks4' | 'mtproto'
}

export type ProxyParseResult = {
	proxies: ParsedProxy[]
	/** Строки, которые не приняли: номер строки, текст и причина. */
	rejected: Array<{ line: number; text: string; reason: string }>
}

const SCHEME = /^([a-z0-9+.-]+):\/\//i

/** Строка `secret` в ссылке Telegram бывает base64url; проверяем ровно те
 * форматы, которые принимает teleproto: 16 байт, dd+16 или ee+16+домен. */
function isMtprotoSecret(value: string): boolean {
	if (!value) return false
	const normalized = value.replace(/\\([_-])/g, '$1').replace(/-/g, '+').replace(/_/g, '/')
	const raw = /^[0-9a-f]+$/i.test(normalized)
		? Buffer.from(normalized, 'hex')
		: Buffer.from(normalized, 'base64')
	return raw.length === 16 || (raw.length === 17 && raw[0] === 0xdd) || (raw.length > 17 && raw[0] === 0xee)
}

function parseMtprotoLink(raw: string): ParsedProxy | string | null {
	if (!/^tg:\/\/proxy(?:\?|\/)/i.test(raw.trim())) return null
	let url: URL
	try { url = new URL(raw.trim().replace(/\\([_-])/g, '$1')) } catch { return 'не удалось прочитать ссылку MTProxy' }
	const host = (url.searchParams.get('server') ?? '').trim()
	const port = Number(url.searchParams.get('port'))
	const secret = (url.searchParams.get('secret') ?? '').trim()
	if (!isHost(host)) return `не похоже на адрес сервера: «${host}»`
	if (!Number.isInteger(port) || port < 1 || port > 65535) return 'в ссылке MTProxy нет корректного port'
	if (!isMtprotoSecret(secret)) return 'в ссылке MTProxy некорректный secret'
	return { host, port, username: null, password: null, secret, kind: 'mtproto' }
}

function isHost(s: string): boolean {
	if (!s || s.length > 253) return false
	// IPv4, IPv6 в скобках или доменное имя.
	if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) return s.split('.').every(o => Number(o) <= 255)
	if (/^\[[0-9a-f:]+\]$/i.test(s)) return true
	return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(s)
}

function parseLine(raw: string): ParsedProxy | string {
	let text = raw.trim()
	if (!text) return 'пустая строка'
	const mtproto = parseMtprotoLink(text)
	if (mtproto) return mtproto

	let kind: ParsedProxy['kind'] = 'socks5'
	const scheme = text.match(SCHEME)
	if (scheme) {
		const s = scheme[1].toLowerCase()
		if (s === 'socks4' || s === 'socks4a') kind = 'socks4'
		else if (s === 'socks5' || s === 'socks5h' || s === 'socks') kind = 'socks5'
		else if (s === 'http' || s === 'https') {
			return 'HTTP-прокси не подходит: Telegram по MTProto ходит только через SOCKS4/SOCKS5'
		} else return `неизвестная схема «${s}»`
		text = text.slice(scheme[0].length)
	}
	text = text.replace(/\/+$/, '')

	let creds: string | null = null
	let hostPart = text

	// Форма «логин:пароль@host:port».
	const at = text.lastIndexOf('@')
	if (at >= 0) {
		const before = text.slice(0, at)
		const after = text.slice(at + 1)
		// Бывает и наоборот — «host:port@логин:пароль». Различаем по тому,
		// с какой стороны стоит номер порта.
		if (/^[^:]+:\d{1,5}$/.test(after) || isHost(after)) {
			creds = before
			hostPart = after
		} else {
			hostPart = before
			creds = after
		}
	}

	// IPv6 пишется в скобках, иначе его двоеточия не отличить от разделителей.
	const v6 = hostPart.match(/^(\[[0-9a-f:]+\]):(.+)$/i)
	const bits = v6 ? [v6[1], v6[2]] : hostPart.split(':')

	// «host:port:логин:пароль» — запись без собаки. Пароль сам может содержать
	// двоеточие, поэтому в логин уходит третья часть, а в пароль весь остаток.
	if (bits.length > 2 && !creds) {
		creds = bits.slice(2).join(':')
		bits.length = 2
	}
	if (bits.length !== 2) return 'непонятный формат: ожидалось host:port'

	const host = bits[0].trim()
	const port = Number(bits[1].trim())
	if (!isHost(host)) return `не похоже на адрес: «${host}»`
	if (!Number.isInteger(port) || port < 1 || port > 65535) return `неверный порт: «${bits[1]}»`

	let username: string | null = null
	let password: string | null = null
	if (creds) {
		const sep = creds.indexOf(':')
		if (sep < 0) return 'у прокси есть логин, но нет пароля'
		username = creds.slice(0, sep)
		password = creds.slice(sep + 1)
		if (!username) return 'пустой логин'
	}

	return { host, port, username, password, secret: null, kind }
}

export function parseProxyPool(text: string): ProxyParseResult {
	const proxies: ParsedProxy[] = []
	const rejected: ProxyParseResult['rejected'] = []
	// Дубли внутри одной вставки убираем сразу: в базе стоит уникальный индекс,
	// но падать вставкой из-за копипасты незачем.
	const seen = new Set<string>()

	const lines = text.split(/\r?\n/)
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]
		if (!line.trim() || line.trim().startsWith('#')) continue
		const res = parseLine(line)
		if (typeof res === 'string') {
			rejected.push({ line: i + 1, text: line.trim(), reason: res })
			continue
		}
		const key = `${res.kind}:${res.host}:${res.port}:${res.username ?? ''}:${res.secret ?? ''}`
		if (seen.has(key)) {
			rejected.push({ line: i + 1, text: line.trim(), reason: 'дубль в этом же списке' })
			continue
		}
		seen.add(key)
		proxies.push(res)
	}
	return { proxies, rejected }
}
