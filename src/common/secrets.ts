import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto'

/**
 * Шифрование секретов, которые лежат в базе: пока это строковые сессии Telegram.
 *
 * Зачем вообще. Сессия Telegram — не пароль, а готовый ключ: кто её унёс, тот
 * зашёл в аккаунт без кода и без телефона. Дамп базы, бэкап, скриншот в чате —
 * любой из этих путей отдаёт аккаунты целиком, поэтому в колонке лежит шифртекст.
 *
 * aes-256-gcm, а не cbc: GCM даёт проверку целостности. Если строку в базе
 * поправят руками или она побьётся при переносе, расшифровка упадёт с ошибкой,
 * а не вернёт мусор, который потом уйдёт в Telegram как ключ.
 *
 * Ключ берётся из SECRETS_KEY. Переменной нет — сервис не стартует: молча
 * шифровать нулевым ключом хуже, чем не запуститься.
 */

const ALGO = 'aes-256-gcm'
const IV_LEN = 12 // рекомендованная длина nonce для GCM
const TAG_LEN = 16

let cached: Buffer | null = null

function key(): Buffer {
	if (cached) return cached
	const raw = process.env.SECRETS_KEY
	if (!raw || raw.length < 16) {
		throw new Error(
			'Не задан SECRETS_KEY (минимум 16 символов). Без него шифровать сессии Telegram нечем.',
		)
	}
	// Строка произвольной длины сворачивается в 32 байта. Так переменную можно
	// задать читаемой фразой, а не ровно 32 байтами в hex.
	cached = createHash('sha256').update(raw, 'utf8').digest()
	return cached
}

/** Есть ли чем шифровать. Нужно, чтобы показать понятную ошибку в интерфейсе. */
export function secretsReady(): boolean {
	const raw = process.env.SECRETS_KEY
	return !!raw && raw.length >= 16
}

/** Формат: base64(iv) . base64(tag) . base64(данные) — точка в base64 не встречается. */
export function encryptSecret(plain: string): string {
	const iv = randomBytes(IV_LEN)
	const cipher = createCipheriv(ALGO, key(), iv)
	const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
	return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join('.')
}

export function decryptSecret(stored: string): string {
	const parts = stored.split('.')
	if (parts.length !== 3) throw new Error('Испорченный секрет: неверный формат')
	const [iv, tag, data] = parts.map(p => Buffer.from(p, 'base64'))
	if (iv.length !== IV_LEN || tag.length !== TAG_LEN) {
		throw new Error('Испорченный секрет: неверная длина заголовка')
	}
	const decipher = createDecipheriv(ALGO, key(), iv)
	decipher.setAuthTag(tag)
	return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
}
