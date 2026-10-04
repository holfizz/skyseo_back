// Run after npm run build. Uses an in-memory Prisma stub; never connects to a DB.
const assert = require('node:assert/strict')
const { CampaignService } = require('../dist/src/tg-warmup/campaign.service')

function matches(row, where) {
	return Object.entries(where).every(([key, value]) => {
		if (key === 'AND') return value.every(w => matches(row, w))
		if (key === 'OR') return value.some(w => matches(row, w))
		if (key === 'NOT') return !matches(row, value)
		if (value && typeof value === 'object') {
			if ('some' in value) return (row[key] ?? []).some(r => matches(r, value.some))
			if ('not' in value) return row[key] !== value.not
			if ('in' in value) return value.in.includes(row[key])
			if ('contains' in value) return String(row[key] ?? '').toLowerCase().includes(value.contains.toLowerCase())
		}
		return row[key] === value
	})
}

const leads = [
	['fresh', '@fresh'], ['queued', '@queued'], ['sent', '@changed'],
	['duplicate', 'https://t.me/AlreadySent'], ['phone', '+7 (900) 123-45-67'],
	['manual-reply', '@manual'], ['incoming-only', '@incoming'],
	['uncertain', '@uncertain'], ['second-touch', '@second'],
	['empty', null], ['parked', '@parked'],
].map(([id, telegram]) => ({
	id, telegram, telegramManual: !!telegram, inn: '1234567890', notes: null,
	parkedAt: id === 'parked' ? new Date() : null, domain: `${id}.example`,
}))
const recipients = [
	{ leadId: 'queued' },
	{ leadId: 'sent', username: 'alreadysent', sentAt: new Date() },
	{ phone: '79001234567', sentAt: new Date() },
	{ username: 'manual', messages: [{ out: true }] },
	{ leadId: 'incoming-only', messages: [{ out: false }] },
	{ leadId: 'uncertain', deliveryUnknown: true },
	{ leadId: 'second-touch', secondSentAt: new Date() },
].map(r => ({ leadId: null, username: null, phone: null, sentAt: null, secondSentAt: null, deliveryUnknown: false, messages: [], ...r }))
const service = Object.create(CampaignService.prototype)
service.prisma = {
	outreachLead: {
		findMany: async ({ where, skip = 0, take = leads.length }) => leads.filter(r => matches(r, where)).slice(skip, skip + take),
		count: async ({ where }) => leads.filter(r => matches(r, where)).length,
	},
	tgRecipient: { findMany: async ({ where }) => recipients.filter(r => matches(r, where)) },
}

async function main() {
	const filled = await service.leadsBase({ filter: 'filled' })
	assert.deepEqual(filled.rows.map(r => r.id), ['fresh', 'queued', 'incoming-only'])
	assert.equal(filled.total, 3)
	assert.equal(filled.filled, 3)
	assert.equal(filled.empty, 1)
	assert.equal(filled.parked, 1)
	assert.equal(filled.rows.find(r => r.id === 'queued').inCampaign, true)
	const page = await service.leadsBase({ filter: 'filled', limit: 1, offset: 1 })
	assert.deepEqual(page.rows.map(r => r.id), ['queued'])
	assert.equal(page.total, 3)
	const search = await service.leadsBase({ filter: 'filled', q: 'fresh' })
	assert.deepEqual(search.rows.map(r => r.id), ['fresh'])
	assert.equal(search.total, 1)
	assert.equal(search.filled, 3)
	assert.equal((await service.leadsBase({ filter: 'all' })).total, leads.length)
	assert.deepEqual((await service.leadsBase({ filter: 'empty' })).rows.map(r => r.id), ['empty'])
	assert.deepEqual((await service.leadsBase({ filter: 'parked' })).rows.map(r => r.id), ['parked'])
	// Once a queued contact receives a message, both the list and counter update.
	recipients[0].sentAt = new Date()
	const refreshed = await service.leadsBase({ filter: 'filled' })
	assert.deepEqual(refreshed.rows.map(r => r.id), ['fresh', 'incoming-only'])
	assert.equal(refreshed.filled, 2)
	console.log('PASS: unwritten contacts, duplicate identities, messages, counters, pagination and other tabs')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
