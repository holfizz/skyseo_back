/**
 * Минимальный читатель SQLite: ровно столько, сколько нужно, чтобы достать
 * ключ из файла .session (формат Telethon).
 *
 * Зачем свой, а не библиотека. better-sqlite3 — нативный модуль, а бэкенд
 * собирается на node:20-alpine (musl), где для него нет пребилдов и npm ci
 * ушёл бы в компиляцию. sql.js весит 21 МБ и тянет WASM ради одной строки
 * из одной таблицы. Файл сессии — это маленькая база с единственной записью
 * в таблице sessions, и её разбор укладывается в сотню строк.
 *
 * Что поддержано: обход b-дерева таблицы (внутренние страницы и листья),
 * варинты, все типы значений формата записи. Что НЕ поддержано: страницы
 * переполнения, WAL и индексы. Для файла Telethon это не нужно — запись
 * весит около 300 байт при странице 4096, — но если попадётся что-то другое,
 * читатель бросит понятную ошибку, а не вернёт мусор.
 *
 * Формат: https://www.sqlite.org/fileformat.html
 */

const MAGIC = 'SQLite format 3\0'

export type SqliteValue = number | bigint | string | Buffer | null

/**
 * Строка таблицы. rowid вынесен отдельно не для красоты: колонка, объявленная
 * как INTEGER PRIMARY KEY, физически в записи не хранится — на её месте NULL,
 * а само число лежит в rowid ячейки. Для sessions это dc_id, то есть без rowid
 * номер дата-центра из файла не достать.
 */
export type SqliteRow = { rowid: number; values: SqliteValue[] }

/** Варинт SQLite: до 9 байт, старший бит — признак продолжения. */
function readVarint(buf: Buffer, pos: number): [bigint, number] {
	let result = 0n
	for (let i = 0; i < 8; i++) {
		const byte = buf[pos + i]
		if (byte === undefined) throw new Error('Файл обрывается на середине числа')
		if (i === 7) {
			// Девятый байт отдаёт все восемь бит, а не семь.
			result = (result << 8n) | BigInt(byte)
			return [BigInt.asIntN(64, result), pos + 8]
		}
		result = (result << 7n) | BigInt(byte & 0x7f)
		if ((byte & 0x80) === 0) return [result, pos + i + 1]
	}
	throw new Error('Некорректное число в файле')
}

/**
 * Разбор одной записи (payload ячейки) в список значений.
 * Заголовок записи перечисляет «серийные типы» колонок, дальше идут сами данные.
 */
function parseRecord(payload: Buffer): SqliteValue[] {
	const [headerSize, afterSize] = readVarint(payload, 0)
	const headerEnd = Number(headerSize)
	if (headerEnd > payload.length) throw new Error('Заголовок записи выходит за границы')

	const types: bigint[] = []
	let pos = afterSize
	while (pos < headerEnd) {
		const [type, next] = readVarint(payload, pos)
		types.push(type)
		pos = next
	}

	const values: SqliteValue[] = []
	let data = headerEnd
	for (const type of types) {
		const t = Number(type)
		if (t === 0) {
			values.push(null)
		} else if (t >= 1 && t <= 5) {
			// readIntBE умеет максимум 6 байт, поэтому восьмибайтные идут отдельно.
			const size = [0, 1, 2, 3, 4, 6][t]
			values.push(payload.readIntBE(data, size))
			data += size
		} else if (t === 6) {
			const big = payload.readBigInt64BE(data)
			// Идентификаторы Telegram в double влезают, но проверку оставляем:
			// молча потерять точность хуже, чем вернуть bigint.
			values.push(
				big >= BigInt(Number.MIN_SAFE_INTEGER) && big <= BigInt(Number.MAX_SAFE_INTEGER)
					? Number(big)
					: big,
			)
			data += 8
		} else if (t === 7) {
			values.push(payload.readDoubleBE(data))
			data += 8
		} else if (t === 8) {
			values.push(0)
		} else if (t === 9) {
			values.push(1)
		} else if (t >= 12 && t % 2 === 0) {
			const size = (t - 12) / 2
			values.push(Buffer.from(payload.subarray(data, data + size)))
			data += size
		} else if (t >= 13) {
			const size = (t - 13) / 2
			values.push(payload.subarray(data, data + size).toString('utf8'))
			data += size
		} else {
			throw new Error(`Неизвестный тип значения: ${t}`)
		}
	}
	return values
}

type Db = { buf: Buffer; pageSize: number; usable: number }

function page(db: Db, num: number): Buffer {
	const start = (num - 1) * db.pageSize
	if (start < 0 || start + db.pageSize > db.buf.length) {
		throw new Error(`Страница ${num} за пределами файла`)
	}
	return db.buf.subarray(start, start + db.pageSize)
}

/**
 * Обход b-дерева таблицы. Собирает payload всех ячеек листьев.
 * Первая страница файла особенная: её b-дерево начинается после 100-байтного
 * заголовка базы, поэтому смещение передаётся отдельно.
 */
function walkTable(db: Db, pageNum: number, out: Array<{ rowid: number; payload: Buffer }>, depth = 0): void {
	if (depth > 20) throw new Error('Слишком глубокое дерево, похоже на зацикливание')
	const p = page(db, pageNum)
	const base = pageNum === 1 ? 100 : 0
	const type = p[base]
	const cells = p.readUInt16BE(base + 3)
	const headerLen = type === 0x05 || type === 0x02 ? 12 : 8
	const pointers = base + headerLen

	if (type === 0x05) {
		// Внутренняя страница: ячейки ведут к потомкам, плюс отдельный правый указатель.
		for (let i = 0; i < cells; i++) {
			const at = p.readUInt16BE(pointers + i * 2)
			walkTable(db, p.readUInt32BE(at), out, depth + 1)
		}
		walkTable(db, p.readUInt32BE(base + 8), out, depth + 1)
		return
	}
	if (type !== 0x0d) throw new Error(`Ожидался лист таблицы, встречен тип ${type}`)

	// Порог, после которого запись уезжает на страницы переполнения.
	const maxLocal = db.usable - 35
	for (let i = 0; i < cells; i++) {
		let at = p.readUInt16BE(pointers + i * 2)
		const [size, afterSize] = readVarint(p, at)
		at = afterSize
		const [rowid, afterRowid] = readVarint(p, at)
		at = afterRowid
		const len = Number(size)
		if (len > maxLocal) {
			throw new Error(
				'В файле есть запись со страницами переполнения — такой формат не поддержан. ' +
					'Скорее всего, это не сессия Telethon.',
			)
		}
		out.push({ rowid: Number(rowid), payload: Buffer.from(p.subarray(at, at + len)) })
	}
}

/**
 * Прочитать все строки таблицы по имени.
 *
 * Значения идут в порядке колонок из CREATE TABLE; имена колонок не разбираем,
 * вызывающему они известны. Колонка INTEGER PRIMARY KEY придёт как NULL — её
 * значение лежит в rowid.
 */
export function readSqliteTable(file: Buffer, table: string): SqliteRow[] {
	if (file.subarray(0, 16).toString('latin1') !== MAGIC) {
		throw new Error('Это не файл SQLite')
	}
	const raw = file.readUInt16BE(16)
	const pageSize = raw === 1 ? 65536 : raw
	const reserved = file[20]
	const db: Db = { buf: file, pageSize, usable: pageSize - reserved }

	// sqlite_master всегда лежит на первой странице и описывает остальные таблицы.
	const master: Array<{ rowid: number; payload: Buffer }> = []
	walkTable(db, 1, master)

	let root = 0
	for (const cell of master) {
		const row = parseRecord(cell.payload) // type, name, tbl_name, rootpage, sql
		if (row[0] === 'table' && row[1] === table) {
			root = Number(row[3])
			break
		}
	}
	if (!root) throw new Error(`В файле нет таблицы «${table}»`)

	const cells: Array<{ rowid: number; payload: Buffer }> = []
	walkTable(db, root, cells)
	return cells.map(c => ({ rowid: c.rowid, values: parseRecord(c.payload) }))
}
