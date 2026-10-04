const assert = require('node:assert/strict')
const { planQueue, slotCapacity, startCursor, windowStart } = require('../dist/src/tg-warmup/campaign-plan')
const { CampaignService } = require('../dist/src/tg-warmup/campaign.service')
const now = new Date('2026-10-04T09:00:00+03:00')
const config = { windowFrom: 10, windowTo: 20, minIntervalSec: 240, maxIntervalSec: 900 }
const ids = n => Array.from({ length: n }, (_, i) => String(i))
const slot = (id, quota, day = 0) => ({ id, quota, left: quota, day, floor: 0, readiness: 100, cursor: startCursor(now, config, 0, day) })
function verify(plan) {
	const last = new Map()
	for (const p of [...plan.values()].sort((a, b) => a.at - b.at)) {
		const date = new Date(p.at.getTime() + 3 * 3600000)
		assert.ok(date.getUTCHours() >= 10 && date.getUTCHours() < 20)
		const key = `${p.accountId}:${date.toISOString().slice(0, 10)}`
		if (last.has(key)) assert.ok(p.at - last.get(key) >= 240000)
		last.set(key, p.at)
	}
}
async function main() {
	const random = Math.random
	let seed = 123456
	Math.random = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296)
	try {
		for (let i = 0; i < 300; i++) {
			for (const count of [13, 15]) {
				const plan = planQueue(ids(count), [slot('one', 15)], config, now, { singleDay: true })
				assert.equal(plan.size, count, 'One account fits its full daily quota')
				verify(plan)
			}
			const mixed = planQueue(ids(21), [slot('a', 15), slot('b', 6)], config, now, { singleDay: true })
			assert.equal(mixed.size, 21, 'Unequal quotas must not lose slots to random assignment')
			verify(mixed)
		}
		assert.equal(planQueue(ids(16), [slot('one', 15)], config, now, { singleDay: true }).size, 15)
		const tomorrow = planQueue(ids(15), [slot('one', 15, 1)], config, now, { singleDay: true })
		assert.equal(tomorrow.size, 15)
		verify(tomorrow)
		const rollover = planQueue(ids(31), [slot('one', 15)], config, now)
		assert.equal(rollover.size, 31)
		verify(rollover)
		const late = { ...slot('late', 15), cursor: windowStart(now, 20, 0).getTime() - 10 * 60000 }
		assert.equal(slotCapacity(late, config, now), 3)
		const short = planQueue(ids(13), [late], config, now, { singleDay: true })
		assert.equal(short.size, 3, 'A genuinely short window must still respect minimum intervals')
		verify(short)
	} finally { Math.random = random }
	const service = Object.create(CampaignService.prototype)
	service.prisma = {
		tgAccount: { findMany: async () => [{ id: 'a', status: 'READY', mode: 'OUTREACH', proxyId: 'p' }] },
		tgCampaign: { findFirst: async () => ({ perAccountPerDay: 500, minIntervalSec: 240 }) },
		tgRecipient: { findMany: async () => [] },
	}
	service.warmup = { allowancesFor: async () => new Map([['a', { dailyMessages: 500, maxMessagesPerDay: 500 }]]) }
	const norm = await service.dailyNorm()
	assert.equal(norm.perAccount, 15)
	assert.equal(norm.rows[0].limit, 15)
	assert.ok(norm.launchCount <= 15)
	console.log('PASS: 13/15 per account, uneven quotas, time window, rollover and daily norm ceiling')
}
main().catch(e => { console.error(e); process.exitCode = 1 })
