import { BadRequestException } from '@nestjs/common'
import {
	importFromSessionFile, importFromStringSession, importFromTdataZip, parseCompanionJson,
	type CompanionMeta,
} from './session-import'
import { parseProxyPool, type ParsedProxy } from './proxy-pool'

export type AccountImportInput = {
	files: Array<{ name: string; buffer: Buffer }>
	strings?: string
	passcode?: string
}
export type PendingAccount = { key: string; session: string; meta: CompanionMeta; source: string }
export type ImportProxyChoice = {
	key: string
	mode: 'pool' | 'new' | 'existing' | 'none'
	proxyId?: string
	text?: string
}

/** Both preview and save decode locally; neither connects to Telegram. */
export async function collectImportAccounts(input: AccountImportInput) {
	const files = input.files ?? []
	const metaByName = new Map<string, CompanionMeta>()
	for (const file of files) {
		if (!/\.json$/i.test(file.name)) continue
		try { metaByName.set(file.name.replace(/\.json$/i, ''), parseCompanionJson(file.buffer.toString('utf8'))) }
		catch { /* An invalid companion must not discard a valid session. */ }
	}
	const one = metaByName.size === 1 ? [...metaByName.values()][0] : undefined
	const common: CompanionMeta = one ? { apiId: one.apiId, apiHash: one.apiHash } : {}
	const pending: PendingAccount[] = []
	const errors: Array<{ source: string; reason: string }> = []
	for (const [index, file] of files.entries()) {
		if (/\.json$/i.test(file.name)) continue
		const meta = metaByName.get(file.name.replace(/\.[^.]+$/, '')) ?? common
		try {
			if (/\.zip$/i.test(file.name)) {
				const accounts = await importFromTdataZip(file.buffer, input.passcode)
				// A companion for an archive may describe only one of its slots.
				// Share application/device data, never its phone or personal name.
				const archiveMeta: CompanionMeta = accounts.length > 1 ? {
					apiId: meta.apiId, apiHash: meta.apiHash, deviceModel: meta.deviceModel,
					systemVersion: meta.systemVersion, appVersion: meta.appVersion,
					langCode: meta.langCode, systemLangCode: meta.systemLangCode,
				} : meta
				for (const account of accounts) pending.push({
					key: `file:${index}:${account.index}`,
					session: account.session,
					meta: { ...archiveMeta, userId: account.userId ?? archiveMeta.userId },
					source: accounts.length > 1 ? `${file.name} (слот ${account.index})` : file.name,
				})
			} else {
				const account = /\.session$/i.test(file.name)
					? importFromSessionFile(file.buffer)
					: importFromStringSession(file.buffer.toString('utf8'))
				pending.push({ key: `file:${index}:0`, session: account.session, meta, source: file.name })
			}
		} catch { errors.push({ source: file.name, reason: 'Не удалось прочитать сессию. Проверьте формат файла и локальный пароль tdata.' }) }
	}
	for (const [index, line] of String(input.strings ?? '').split(/\r?\n/).entries()) {
		if (!line.trim()) continue
		try { pending.push({ key: `string:${index}`, session: importFromStringSession(line).session, meta: common, source: `строка ${index + 1}` }) }
		catch { errors.push({ source: `строка ${index + 1}`, reason: 'Строка не похожа на авторизованную сессию GramJS или Telethon.' }) }
	}
	return { pending, errors }
}

/** Multipart JSON is untrusted; reject stale keys before creating anything. */
export function importSelection(pending: PendingAccount[], keysJson?: string, choicesJson?: string) {
	const available = new Set(pending.map(account => account.key))
	let keys = [...available]
	if (keysJson !== undefined) {
		try { keys = JSON.parse(keysJson) } catch { throw new BadRequestException('Не удалось прочитать список выбранных аккаунтов') }
		if (!Array.isArray(keys) || !keys.length || keys.some(key => typeof key !== 'string' || !available.has(key)) || new Set(keys).size !== keys.length) {
			throw new BadRequestException('Список аккаунтов изменился. Подготовьте загрузку заново.')
		}
	}
	const choices = new Map<string, ImportProxyChoice>()
	if (choicesJson !== undefined) {
		let raw: unknown
		try { raw = JSON.parse(choicesJson) } catch { throw new BadRequestException('Не удалось прочитать выбор прокси') }
		if (!Array.isArray(raw) || raw.length > pending.length) throw new BadRequestException('Некорректный список прокси')
		for (const item of raw) {
			if (!item || typeof item !== 'object' || !keys.includes(item.key) || choices.has(item.key) || !['pool', 'new', 'existing', 'none'].includes(item.mode)) {
				throw new BadRequestException('Выбор прокси не соответствует загружаемым аккаунтам')
			}
			if (item.mode === 'new' && (typeof item.text !== 'string' || item.text.length > 4096)) throw new BadRequestException('Некорректная строка нового прокси')
			if (item.mode === 'existing' && (typeof item.proxyId !== 'string' || !item.proxyId.trim())) throw new BadRequestException('Выберите прокси из пула')
			choices.set(item.key, item)
		}
		if (choices.size !== keys.length) throw new BadRequestException('Укажите выбор прокси для каждого аккаунта')
	}
	return { accounts: pending.filter(account => keys.includes(account.key)), choices }
}

export function newImportProxy(text: string): ParsedProxy {
	const result = parseProxyPool(text)
	if (result.rejected.length || result.proxies.length !== 1) {
		throw new BadRequestException('Укажите один корректный SOCKS4, SOCKS5 или MTProxy для этого аккаунта')
	}
	return result.proxies[0]
}
