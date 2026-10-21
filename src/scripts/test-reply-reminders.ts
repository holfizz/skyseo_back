import 'reflect-metadata'
import { strict as assert } from 'node:assert'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { ReplyReminderService } from '../tg-warmup/reply-reminder.service'
import { CampaignService } from '../tg-warmup/campaign.service'
import { senderLabel } from '../tg-warmup/sender-label'

const database = process.env.REPLY_REMINDER_TEST_DATABASE_URL
if (!database) throw new Error('Set REPLY_REMINDER_TEST_DATABASE_URL to an isolated local test database')
const url = new URL(database)
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.pathname.startsWith('/skyseo_callprep_')) {
	throw new Error('Only a dedicated local skyseo_callprep_* database is allowed')
}
const prisma = new PrismaClient({ datasources: { db: { url: database } } })
const start = new Date('2026-10-18T10:00:00Z')
const at = (minutes: number) => new Date(start.getTime() + minutes * 60_000)
const alerts: string[] = []
const telegram = { sendOutreachNotification: async (html: string) => { alerts.push(html) } }
const service = new ReplyReminderService(prisma as any, telegram as any)
const worker2 = new ReplyReminderService(prisma as any, telegram as any)
let campaignId: string
let accountId: string

async function recipient(name: string) {
	return prisma.tgRecipient.create({ data: { campaignId, firstName: name, domain: 'fixture.invalid', status: 'SENT', sentAt: at(-1), sentMsgId: 1,
		messages: { create: { tgId: 1, out: true, text: 'Здравствуйте', date: at(-1) } } } })
}
async function incoming(recipientId: string, tgId: number, minute: number, text = 'Интересно') {
	const m = await prisma.tgDialogMessage.create({ data: { recipientId, tgId, out: false, text, date: at(minute) } })
	await service.trackIncoming(recipientId, [m])
	return m
}

async function main() {
	assert.equal(senderLabel({ firstName: 'Анна', label: 'internal-id', username: 'anna_fixture' }), 'Анна (@anna_fixture)')
	assert.equal(senderLabel({ label: 'Сергей' }), 'Сергей')
	assert.equal(senderLabel({ username: 'fixture' }), '@fixture')
	assert.equal(senderLabel(null), 'не указан')
	campaignId = (await prisma.tgCampaign.create({ data: { name: `reminder-test-${randomUUID()}`, firstMessage: 'Fixture' } })).id
	try {
		const account = await prisma.tgAccount.create({ data: { firstName: 'Анна <&>', label: 'internal-id', username: 'anna_fixture',
			session: 'not-a-telegram-session', apiId: 1, apiHash: 'fixture', deviceModel: 'test', systemVersion: 'test', appVersion: 'test', langCode: 'ru', systemLangCode: 'ru' } })
		accountId = account.id
		const r = await recipient('Клиент <&>')
		await prisma.tgRecipient.update({ where: { id: r.id }, data: { accountId } })
		// Exercise the real poll -> persisted message -> initial notification -> queue path.
		const campaign = Object.create(CampaignService.prototype) as any
		campaign.prisma = prisma
		campaign.replyReminders = service
		campaign.logger = { warn: () => {} }
		const initial: string[] = []
		campaign.notifyAdmin = async (html: string) => initial.push(html)
		await campaign.applyDialogState({ recipient: { ...r, campaign: { name: 'Fixture' } }, readTo: 1, top: 10 }, [
			{ id: 10, out: false, message: 'Покажите <пример> & результат', date: start.getTime() / 1000 },
		], account)
		assert.equal(initial.length, 1, 'Existing immediate notification remains')
		assert.match(initial[0], /С аккаунта: <b>Анна &lt;&amp;&gt; \(@anna_fixture\)<\/b>/)
		assert.equal(await service.tick(at(29)), 0)
		// Opening a chat must not cancel an unanswered message.
		await prisma.tgRecipient.update({ where: { id: r.id }, data: { unreadIn: 0 } })
		assert.equal(await service.tick(at(30)), 1)
		assert.match(alerts[0], /Напоминание 1 из 2/)
		assert.match(alerts[0], /&lt;пример&gt; &amp; результат/)
		assert.match(alerts[0], /Клиент &lt;&amp;&gt;/)
		assert.match(alerts[0], /С аккаунта: <b>Анна &lt;&amp;&gt; \(@anna_fixture\)<\/b>/)
		assert.match(alerts[0], new RegExp(`dialog=${r.id}`))
		assert.equal(await service.tick(at(31)), 0)
		await incoming(r.id, 11, 40, 'Еще один вопрос')
		await service.trackIncoming(r.id, [{ tgId: 11, date: at(40) }])
		assert.equal((await prisma.tgReplyReminder.findUniqueOrThrow({ where: { recipientId: r.id } })).anchorTgId, 10)
		assert.equal(await worker2.tick(at(89)), 0, 'Restart preserves original timer')
		const concurrent = await Promise.all([service.tick(at(90)), worker2.tick(at(90))])
		assert.equal(concurrent.reduce((a, b) => a + b), 1, 'Two workers claim only one notification')
		assert.equal(alerts.length, 2)
		assert.match(alerts[1], /Напоминание 2 из 2/)
		assert.match(alerts[1], /Еще один вопрос/)
		await incoming(r.id, 12, 95)
		assert.equal(await worker2.tick(at(200)), 0, 'No third reminder for a continuous unanswered burst')

		await prisma.tgDialogMessage.create({ data: { recipientId: r.id, tgId: 13, out: true, text: '[Фото]', date: at(201) } })
		await incoming(r.id, 14, 202)
		assert.equal(await worker2.tick(at(231)), 0)
		assert.equal(await worker2.tick(at(232)), 1, 'A new incoming after a reply starts a new cycle')
		await prisma.tgDialogMessage.create({ data: { recipientId: r.id, tgId: 15, out: true, text: 'Ответ из Telegram', date: at(233) } })
		assert.equal(await service.tick(at(292)), 0, 'Confirmed outgoing cancels final reminder')

		const before = await recipient('Ответили до 30 минут')
		await incoming(before.id, 10, 0)
		await prisma.tgDialogMessage.create({ data: { recipientId: before.id, tgId: 11, out: true, text: 'Ответ', date: at(1) } })
		assert.equal(await service.tick(at(90)), 0)
		assert.equal((await prisma.tgReplyReminder.findUniqueOrThrow({ where: { recipientId: before.id } })).nextAt, null)

		const recovery = await recipient('После простоя')
		await incoming(recovery.id, 10, 0)
		assert.equal(await worker2.tick(at(120)), 1)
		assert.match(alerts.at(-1)!, /Напоминание 2 из 2/)
		assert.equal(await service.tick(at(121)), 0, 'Do not catch up with two alerts after downtime')

		const failing = await recipient('Неопределенная доставка')
		await incoming(failing.id, 10, 0)
		let attempts = 0
		const uncertain = new ReplyReminderService(prisma as any, { sendOutreachNotification: async () => { attempts++; throw Error('timeout') } } as any)
		assert.equal(await uncertain.tick(at(30)), 0)
		assert.equal(await uncertain.tick(at(31)), 0)
		assert.equal(attempts, 1, 'Unknown delivery must not retry the same slot')
		assert.equal((await prisma.tgReplyReminder.findUniqueOrThrow({ where: { recipientId: failing.id } })).lastSentAt, null)
		assert.equal(await uncertain.tick(at(90)), 0)
		assert.equal(await uncertain.tick(at(91)), 0)
		assert.equal(attempts, 2, 'At most two attempts per unanswered burst, even on API errors')

		// An outgoing after the old anchor must cancel it even when another
		// incoming is already saved but its poll callback has not completed.
		const race = await recipient('Гонка синхронизации')
		await incoming(race.id, 10, 0)
		await prisma.tgDialogMessage.createMany({ data: [
			{ recipientId: race.id, tgId: 11, out: true, text: 'Ответ', date: at(1) },
			{ recipientId: race.id, tgId: 12, out: false, text: 'Новый вопрос', date: at(2) },
		] })
		assert.equal(await service.tick(at(30)), 0)
		await service.trackIncoming(race.id, [{ tgId: 12, date: at(2) }])
		assert.equal(await service.tick(at(32)), 1)
		assert.equal((await prisma.tgReplyReminder.findUniqueOrThrow({ where: { recipientId: race.id } })).anchorTgId, 12)

		const historical = await recipient('Старая переписка')
		await prisma.tgDialogMessage.create({ data: { recipientId: historical.id, tgId: 10, out: false, text: 'Старое сообщение', date: at(-10000) } })
		assert.equal(await prisma.tgReplyReminder.count({ where: { recipientId: historical.id } }), 0, 'No backfill or notices for old conversations on startup')
		console.log('Reply reminders: poll integration, 30/90 min, read state, burst, restart, concurrency, reply cancellation, new cycle, downtime, API failure and race checks passed')
	} finally {
		await prisma.tgCampaign.delete({ where: { id: campaignId } })
		if (accountId) await prisma.tgAccount.delete({ where: { id: accountId } })
		assert.equal(await prisma.tgReplyReminder.count({ where: { recipient: { campaignId } } }), 0)
		await prisma.$disconnect()
	}
}

void main().catch(error => { console.error(error); process.exitCode = 1 })
