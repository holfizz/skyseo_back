import 'reflect-metadata'
import { strict as assert } from 'node:assert'
import { serializeGramjsSession } from '@mtcute/convert'
import { TgWarmupService } from '../tg-warmup/tg-warmup.service'
import { collectImportAccounts, importSelection } from '../tg-warmup/account-import'
import * as sessions from '../tg-warmup/session-import'
import { decryptSecret } from '../common/secrets'

// Synthetic keys only. This suite never loads .env or connects to Telegram/DB.
process.env.SECRETS_KEY = 'account-import-test-key-only'
const session = (index: number) => serializeGramjsSession({ dcId: 2, ipAddress: '149.154.167.51', ipv6: false, port: 443, authKey: new Uint8Array(256).fill(index) })
const input = (count = 1) => ({ files: [], strings: Array.from({ length: count }, (_, index) => session(index + 1)).join('\n'), apiId: 12345, apiHash: 'synthetic-api-hash' })

function fixture() {
	let accounts: any[] = []
	let proxies: any[] = ['pool', 'pool-selected'].map(id => ({ id, host: `${id}.example.org`, port: 1080, username: null, password: null, secret: null, kind: 'socks5', alive: true }))
	let failCreate = false
	const matches = (row: any, where: any) => Object.entries(where ?? {}).every(([key, value]) => {
		if (value && typeof value === 'object' && 'notIn' in value) return !(value as any).notIn.includes(row[key])
		return row[key] === value
	})
	const withCount = (proxy: any) => proxy && ({ ...proxy, _count: { accounts: accounts.filter(account => account.proxyId === proxy.id).length } })
	const prisma: any = {
		tgProxy: {
			findFirst: async ({ where }: any) => withCount(proxies.find(proxy => matches(proxy, where))),
			findUnique: async ({ where }: any) => proxies.find(proxy => matches(proxy, where)),
			findMany: async ({ where }: any) => proxies.filter(proxy => matches(proxy, where)).map(withCount),
			create: async ({ data }: any) => { const row = { id: `proxy-${proxies.length}`, ...data }; proxies.push(row); return row },
		},
		tgAccount: {
			findFirst: async ({ where }: any) => accounts.find(account => matches(account, where)),
			create: async ({ data }: any) => {
				if (failCreate) throw new Error('Synthetic database error; must not expose request credentials')
				const row = { id: `account-${accounts.length}`, ...data }; accounts.push(row); return row
			},
			update: async ({ where, data }: any) => Object.assign(accounts.find(account => matches(account, where)), data),
		},
		$transaction: async (run: any) => {
			const previousAccounts = accounts.slice(), previousProxies = proxies.slice()
			try { return await run(prisma) }
			catch (error) { accounts = previousAccounts; proxies = previousProxies; throw error }
		},
	}
	const service = new TgWarmupService(prisma, {} as any)
	;(service as any).getApiDefaults = async () => ({ apiId: 12345, apiHash: 'synthetic-api-hash' })
	;(service as any).joinActiveCampaigns = async () => {}
	return { service, accounts: () => accounts, proxies: () => proxies, fail: () => { failCreate = true } }
}

async function main() {
	const f = fixture()
	const preview = await f.service.previewAccounts(input(5))
	assert.equal(preview.accounts.length, 5)
	assert.equal(f.accounts().length, 0, 'preview must not create accounts or proxies')
	assert.equal(f.proxies().length, 2)
	assert.ok(!JSON.stringify(preview).includes(session(1)), 'preview must not expose session keys')
	const choices = preview.accounts.map((account, index) => index < 2
		? { key: account.key, mode: 'new', text: `fresh-${index}.example.org:1080:login:synthetic-password` }
		: index === 2 ? { key: account.key, mode: 'pool' }
		: index === 3 ? { key: account.key, mode: 'existing', proxyId: 'pool-selected' }
		: { key: account.key, mode: 'none' })
	const purchasedAt = new Date(Date.now() - 60_000).toISOString()
	const result = await f.service.importAccounts({ ...input(5), purchasedAt, accountKeys: JSON.stringify(preview.accounts.map(account => account.key)), proxyChoices: JSON.stringify(choices) })
	assert.equal(result.created, 5)
	assert.equal(result.errors.length, 0)
	assert.equal(result.handledKeys.length, 5)
	assert.equal(f.proxies().length, 4)
	assert.equal(f.accounts()[0].proxyId, 'proxy-2')
	assert.equal(f.accounts()[1].proxyId, 'proxy-3')
	assert.equal(f.accounts()[2].proxyId, 'pool', 'pool must not take manually assigned fresh proxies')
	assert.equal(f.accounts()[3].proxyId, 'pool-selected')
	assert.equal(f.accounts()[4].proxyId, null)
	assert.equal(result.pool.assigned, 1)
	assert.ok(f.accounts().every(account => account.status === 'NEW' && account.purchasedAt.toISOString() === purchasedAt))
	assert.equal(decryptSecret(f.accounts()[0].session), session(1))

	const partial = fixture()
	const partialChoices = [{ key: 'string:0', mode: 'new', text: 'http://invalid.example.org:80' }, { key: 'string:1', mode: 'new', text: 'valid.example.org:1080:user:password' }]
	const first = await partial.service.importAccounts({ ...input(2), proxyChoices: JSON.stringify(partialChoices) })
	assert.equal(first.created, 1)
	assert.deepEqual(first.handledKeys, ['string:1'])
	assert.equal(first.errors[0].source, 'строка 1')
	assert.equal(partial.accounts().length, 1, 'bad fresh proxy must not silently create an account without proxy')
	const retry = await partial.service.importAccounts({ ...input(2), accountKeys: '["string:0"]', proxyChoices: JSON.stringify([{ key: 'string:0', mode: 'pool' }]) })
	assert.equal(retry.created, 1)
	assert.equal(partial.accounts().length, 2, 'partial retry must not re-import successful rows')

	const rollback = fixture()
	rollback.fail()
	const failed = await rollback.service.importAccounts({ ...input(), proxyChoices: JSON.stringify([{ key: 'string:0', mode: 'new', text: 'rollback.example.org:1080:user:password' }]) })
	assert.equal(failed.created, 0)
	assert.equal(rollback.proxies().length, 2, 'proxy creation must roll back when account creation fails')
	assert.ok(!JSON.stringify(failed).includes('password'))

	const occupied = await f.service.importAccounts({ ...input(), proxyChoices: JSON.stringify([{ key: 'string:0', mode: 'new', text: 'fresh-0.example.org:1080:login:synthetic-password' }]) })
	assert.equal(occupied.created, 0, 'fresh mode must not silently reuse an occupied proxy')
	const deleted = await f.service.importAccounts({ ...input(), proxyChoices: JSON.stringify([{ key: 'string:0', mode: 'existing', proxyId: 'deleted' }]) })
	assert.equal(deleted.created, 0)

	const decoded = await collectImportAccounts(input(2))
	assert.throws(() => importSelection(decoded.pending, '["string:99"]'))
	assert.throws(() => importSelection(decoded.pending, undefined, 'not JSON'))
	assert.throws(() => importSelection(decoded.pending, undefined, '[{"key":"string:0","mode":"pool"}]'))

	const companion = await collectImportAccounts({ files: [
		{ name: 'one.txt', buffer: Buffer.from(session(1)) },
		{ name: 'one.json', buffer: Buffer.from(JSON.stringify({ phone: '+70000000000', user_id: '123', app_id: 12345, app_hash: 'synthetic-api-hash' })) },
		{ name: 'two.txt', buffer: Buffer.from(session(2)) },
	], strings: `\n${session(3)}` })
	assert.equal(companion.pending[0].meta.phone, '+70000000000')
	assert.equal(companion.pending[1].meta.phone, undefined, 'shared API JSON must not spread another account identity')
	assert.equal(companion.pending[2].key, 'string:1', 'blank lines must not shift proxy keys')

	const originalTdata = sessions.importFromTdataZip
	try {
		;(sessions as any).importFromTdataZip = async () => [{ session: session(4), index: 0, userId: '4' }, { session: session(5), index: 2, userId: '5' }]
		const archive = await collectImportAccounts({ files: [
			{ name: 'accounts.zip', buffer: Buffer.alloc(0) },
			{ name: 'accounts.json', buffer: Buffer.from(JSON.stringify({ phone: '+70000000000', user_id: '999', app_id: 12345 })) },
		] })
		assert.deepEqual(archive.pending.map(account => account.key), ['file:0:0', 'file:0:2'])
		assert.deepEqual(archive.pending.map(account => account.meta.userId), ['4', '5'])
		assert.ok(archive.pending.every(account => !account.meta.phone && account.meta.apiId === 12345))
	} finally { (sessions as any).importFromTdataZip = originalTdata }

	const legacy = fixture()
	assert.equal((await legacy.service.importAccounts(input())).pool?.assigned, 1)
	assert.equal((await legacy.service.importAccounts({ ...input(), proxyMode: 'none' })).pool, null)
	console.log('Account import: mixed five-account batch, private preview, proxy binding, rollback, partial retry, stale input, tdata slots and legacy defaults passed.')
}
void main().catch(error => { console.error(error); process.exitCode = 1 })
