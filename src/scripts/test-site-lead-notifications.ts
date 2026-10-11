import { strict as assert } from 'node:assert'
import { SiteLeadService } from '../outreach/site-lead.service'

const originalFetch = globalThis.fetch
const sent: Array<{ chat_id: string; text: string }> = []
globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
	sent.push(JSON.parse(String(init?.body)))
	return new Response(JSON.stringify({ ok: true }), { status: 200 })
}) as typeof fetch

const config = { get: (key: string) => ({ TELEGRAM_BOT_TOKEN: 'a'.repeat(30), TELEGRAM_ADMIN_ID: '123' })[key] }
const service = new SiteLeadService({} as any, config as any)

async function main() {
	try {
		await (service as any).notifyAdmin({ domain: 'example.ru', telegram: '@person', auto: false })
		assert.deepEqual(sent.map(message => message.chat_id), ['123', '7271373084'])
		assert.ok(sent.every(message => message.text.includes('Заявка с сайта')))

		sent.length = 0
		await (service as any).notifyAdmin({ domain: 'example.ru', telegram: '@person', auto: true })
		assert.deepEqual(sent.map(message => message.chat_id), ['123'])
		assert.ok(sent[0].text.includes('Автосохранение'))
		console.log('Site lead notification routing checks passed')
	} finally {
		globalThis.fetch = originalFetch
	}
}

void main().catch(error => { console.error(error); process.exitCode = 1 })
