import { strict as assert } from 'node:assert'
import { CampaignService, workingAccountIds } from '../tg-warmup/campaign.service'

const now = new Date()
const key = '2026-10-11'
const account = { id: 'sender', status: 'READY', mode: 'SEND' }
const link = { accountId: account.id, account, dayKey: key, sentToday: 3, pausedUntil: null, nextSendAt: null }

// Историческая причина недобора: назначение в календаре еще висит, но
// аккаунт уже исчерпал безопасный остаток. Нельзя обещать эти отправки.
assert.deepEqual(workingAccountIds([link], new Map([['sender', 7]]),
	new Map([['sender', { maxMessagesPerDay: 0 }]]), key, now), [])
assert.deepEqual(workingAccountIds([{ ...link, sentToday: 7 }], new Map([['sender', 7]]),
	new Map([['sender', { maxMessagesPerDay: 3 }]]), key, now), [])
assert.deepEqual(workingAccountIds([{ ...link, pausedUntil: new Date(now.getTime() + 60000) }], new Map([['sender', 7]]),
	new Map([['sender', { maxMessagesPerDay: 3 }]]), key, now), [])
assert.deepEqual(workingAccountIds([link], new Map([['sender', 7]]),
	new Map([['sender', { maxMessagesPerDay: 3 }]]), key, now), ['sender'])

const campaign = {
	id: 'campaign', name: 'Проверка', status: 'RUNNING', windowFrom: 0, windowTo: 24,
	dailyGoal: 12, sendDate: now, accounts: [link],
}
const calls: Array<{ settle?: boolean }> = []
const service = Object.create(CampaignService.prototype) as any
service.prisma = {
	tgCampaign: { findMany: async () => [campaign] },
	tgRecipient: {
		count: async ({ where }: any) => {
			if (where.status === 'QUEUED') return 9
			if (where.sentAt?.gte) return 3
			if (where.blockedAt?.gte) return 0
			return 12
		},
		findFirst: async () => null,
		groupBy: async () => [],
	},
}
service.warmup = {
	allowancesFor: async (_accounts: unknown, _day: number, opts: { settle?: boolean }) => {
		calls.push(opts)
		return new Map([['sender', { allowOutgoing: false, maxMessagesPerDay: 0, readiness: 50 }]])
	},
}
service.dailyQuota = async (_campaign: any, _today: string, opts?: { settle?: boolean }) => {
	calls.push(opts ?? {})
	return new Map([['sender', 7]])
}

void service.today().then(result => {
	assert.equal(result.totals.sentToday, 3)
	assert.equal(result.totals.plannedToday, 12)
	assert.equal(result.totals.possibleToday, 0)
	assert.equal(result.sending, false)
	assert.ok(calls.every(x => x.settle === false), 'чтение сводки не утверждает новые лимиты')
	console.log('Campaign today availability checks passed')
}).catch(error => { console.error(error); process.exitCode = 1 })
