import { createCipheriv, createDecipheriv, createHash, pbkdf2, randomBytes, randomFillSync } from 'crypto'

/**
 * Криптография для разбора tdata — ровно то, что запрашивает @mtcute/convert.
 *
 * ЗАЧЕМ СВОЯ. Библиотека умеет взять готового поставщика из @mtcute/node, и
 * сначала так и было сделано. Но @mtcute/node тянет better-sqlite3 — нативный
 * модуль, у которого нет собранных бинарников под musl. На сборке образа
 * (node:20-alpine) npm ci уходил в node-gyp, не находил Python и падал:
 *
 *   npm error path /app/node_modules/better-sqlite3
 *   gyp ERR! find Python ... Could not find any Python installation to use
 *
 * Ставить в образ python3 и build-base ради одной функции — тащить в прод
 * компиляцию нативного кода на каждой сборке. Функция нужна ровно одна:
 * AES в режиме IGE, которого нет в node:crypto. Она ниже, тридцать строк.
 *
 * Остальное берётся из node:crypto как есть. Реализация сверена с @mtcute/node
 * побайтно на контрольном векторе — см. проверку в этом же коммите.
 */

const BLOCK = 16

/**
 * AES в режиме IGE (Infinite Garble Extension) — режим, который использует
 * Telegram и которого нет ни в OpenSSL, ни в node:crypto.
 *
 * Отличие от CBC: каждый блок дополнительно складывается с ПРЕДЫДУЩИМ блоком
 * открытого текста. Поэтому вектор инициализации здесь двойной, 32 байта:
 * первая половина — «предыдущий шифроблок», вторая — «предыдущий открытый».
 *
 *   шифрование:  c[i] = E(m[i] ^ c[i-1]) ^ m[i-1]
 *   расшифровка: m[i] = D(c[i] ^ m[i-1]) ^ c[i-1]
 *
 * Внутри работаем однократным AES-ECB на блок: это и есть «голое» E/D без
 * собственного сцепления, поверх которого и строится IGE.
 */
function ige(key: Uint8Array, iv: Uint8Array, data: Uint8Array, encrypt: boolean): Uint8Array {
	if (iv.length !== 32) throw new Error(`IGE: вектор должен быть 32 байта, получено ${iv.length}`)
	if (data.length % BLOCK !== 0) {
		throw new Error(`IGE: длина данных должна делиться на 16, получено ${data.length}`)
	}

	const algo = key.length === 32 ? 'aes-256-ecb' : key.length === 16 ? 'aes-128-ecb' : null
	if (!algo) throw new Error(`IGE: ключ должен быть 16 или 32 байта, получено ${key.length}`)

	const block = (input: Buffer): Buffer => {
		// Каждый блок шифруем отдельно: ECB без дополнения — это ровно один
		// вызов примитива, сцепление делаем сами.
		if (encrypt) {
			const c = createCipheriv(algo, key, null)
			c.setAutoPadding(false)
			return Buffer.concat([c.update(input), c.final()])
		}
		const d = createDecipheriv(algo, key, null)
		d.setAutoPadding(false)
		return Buffer.concat([d.update(input), d.final()])
	}

	const xor = (a: Buffer, b: Buffer): Buffer => {
		const out = Buffer.allocUnsafe(BLOCK)
		for (let i = 0; i < BLOCK; i++) out[i] = a[i] ^ b[i]
		return out
	}

	const src = Buffer.from(data)
	const out = Buffer.allocUnsafe(src.length)
	// При шифровании первая половина вектора — предыдущий шифроблок, вторая —
	// предыдущий открытый. При расшифровке роли меняются местами.
	let prevCipher = Buffer.from(iv.subarray(encrypt ? 0 : BLOCK, encrypt ? BLOCK : 32))
	let prevPlain = Buffer.from(iv.subarray(encrypt ? BLOCK : 0, encrypt ? 32 : BLOCK))

	for (let i = 0; i < src.length; i += BLOCK) {
		const cur = src.subarray(i, i + BLOCK)
		const res = xor(block(xor(cur, prevCipher)), prevPlain)
		res.copy(out, i)
		prevCipher = Buffer.from(res)
		prevPlain = Buffer.from(cur)
	}
	return out
}

/** Поставщик в том виде, в каком его ждёт @mtcute/convert. */
export function tdataCrypto() {
	return {
		sha1: (data: Uint8Array) => new Uint8Array(createHash('sha1').update(data).digest()),
		sha256: (data: Uint8Array) => new Uint8Array(createHash('sha256').update(data).digest()),
		randomBytes: (size: number) => new Uint8Array(randomBytes(size)),
		randomFill: (buf: Uint8Array) => {
			randomFillSync(buf)
		},
		createHash: (algorithm: 'md5' | 'sha512') => {
			const h = createHash(algorithm)
			return {
				update: (data: Uint8Array) => {
					h.update(data)
				},
				digest: () => new Uint8Array(h.digest()),
			}
		},
		pbkdf2: (password: Uint8Array, salt: Uint8Array, iterations: number, keylen = 64, algo = 'sha512') =>
			new Promise<Uint8Array>((resolve, reject) => {
				pbkdf2(password, salt, iterations, keylen, algo, (err, key) =>
					err ? reject(err) : resolve(new Uint8Array(key)),
				)
			}),
		createAesIge: (key: Uint8Array, iv: Uint8Array) => ({
			encrypt: (data: Uint8Array) => ige(key, iv, data, true),
			decrypt: (data: Uint8Array) => ige(key, iv, data, false),
		}),
	}
}
