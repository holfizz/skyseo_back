import 'reflect-metadata'
import { strict as assert } from 'node:assert'
import { randomUUID } from 'node:crypto'
import { Module } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { PassportModule } from '@nestjs/passport'
import { JwtService } from '@nestjs/jwt'
import { PrismaClient } from '@prisma/client'
import { CampaignService } from '../tg-warmup/campaign.service'
import { CampaignController } from '../tg-warmup/campaign.controller'
import { ReplyReminderService } from '../tg-warmup/reply-reminder.service'
import { JwtStrategy } from '../auth/jwt.strategy'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { AdminGuard } from '../admin/admin.guard'

const database = process.env.REPLY_REMINDER_TEST_DATABASE_URL
if (!database) throw new Error('Set REPLY_REMINDER_TEST_DATABASE_URL')
const parsed = new URL(database)
if (!['localhost', '127.0.0.1'].includes(parsed.hostname) || !parsed.pathname.startsWith('/skyseo_callprep_')) throw Error('Isolated local test database required')
const p = new PrismaClient({ datasources: { db: { url: database } } })
const service = Object.create(CampaignService.prototype) as CampaignService
Object.assign(service, { prisma: p })
const alerts: string[] = []
const reminders = new ReplyReminderService(p as any, { sendOutreachNotification: async (html: string) => { alerts.push(html) } } as any)
const secret = 'conversation-state-local-fixture'
@Module({ imports: [PassportModule], controllers: [CampaignController], providers: [
	{ provide: CampaignService, useValue: service },
	{ provide: JwtStrategy, useFactory: () => new JwtStrategy({ get: () => secret } as any, { findById: (id: string) => p.user.findUnique({ where: { id } }) } as any) },
	JwtAuthGuard, AdminGuard,
] })
class TestModule {}

async function main() {
	const prefix = randomUUID()
	const admin = await p.user.create({ data: { email: `state-${prefix}@example.invalid`, password: 'fixture', role: 'ADMIN', roles: ['ADMIN'], isActive: true } })
	const manager = await p.user.create({ data: { email: `state-manager-${prefix}@example.invalid`, password: 'fixture', role: 'MANAGER', roles: ['MANAGER'], isActive: true } })
	const campaign = await p.tgCampaign.create({ data: { name: prefix, firstMessage: 'Fixture' } })
	const recipient = await p.tgRecipient.create({ data: { campaignId: campaign.id, firstName: 'Тест', status: 'REPLIED', sentAt: new Date(), sentMsgId: 1, repliedAt: new Date(), unreadIn: 1,
		messages: { create: [{ tgId: 1, out: true, text: 'Здравствуйте', date: new Date() }, { tgId: 10, out: false, text: 'Спасибо', date: new Date() }] } } })
	const app = await NestFactory.create(TestModule, { logger: false })
	app.setGlobalPrefix('v1/api'); await app.listen(0, '127.0.0.1')
	const jwt = new JwtService({ secret }), token = jwt.sign({ sub: admin.id })
	const base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}/v1/api/admin/tg-outreach`
	const endpoint = `/recipients/${recipient.id}/conversation-state`
	const req = async (path: string, body?: unknown, auth: string | null = token) => {
		const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'PATCH', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
		return { status: response.status, data: await response.json() }
	}
	try {
		await reminders.trackIncoming(recipient.id, [{ tgId: 10, date: new Date() }])
		assert.equal((await req(endpoint, { replyNeeded: false, expectedTgId: 10 }, null)).status, 401)
		assert.equal((await req(endpoint, { replyNeeded: false, expectedTgId: 10 }, jwt.sign({ sub: manager.id }))).status, 403)
		assert.equal((await req(endpoint, { replyNeeded: 'no', expectedTgId: 10 })).status, 400)
		assert.equal((await req(endpoint, { mark: 'GUESS', expectedTgId: 10 })).status, 400)
		assert.equal((await req(endpoint, { replyNeeded: false })).status, 400)
		let list = await req('/conversations?waiting=1')
		assert.equal(list.data.counts.waiting, 1)
		assert.equal(list.data.rows[0].replyState, 'NEEDS_REPLY')
		let dialog = await req(`/recipients/${recipient.id}/dialog`)
		assert.equal(dialog.data.replyState, 'NEEDS_REPLY', 'Opening the chat is not an answer')
		const handled = await req(endpoint, { replyNeeded: false, expectedTgId: 10 })
		assert.equal(handled.status, 200); assert.equal(handled.data.replyState, 'NO_REPLY_NEEDED')
		assert.equal((await req('/conversations?waiting=1')).data.counts.waiting, 0)
		assert.equal((await p.tgReplyReminder.findUniqueOrThrow({ where: { recipientId: recipient.id } })).nextAt, null)
		assert.equal(await reminders.tick(new Date(Date.now() + 100 * 60_000)), 0)
		assert.equal((await p.tgRecipient.findUniqueOrThrow({ where: { id: recipient.id } })).outcome, null, 'Reply handling does not change the deal outcome')
		const incoming = await p.tgDialogMessage.create({ data: { recipientId: recipient.id, tgId: 11, out: false, text: 'Еще вопрос', date: new Date() } })
		await reminders.trackIncoming(recipient.id, [incoming])
		assert.equal((await req('/conversations?waiting=1')).data.counts.waiting, 1)
		assert.equal((await req(endpoint, { replyNeeded: false, expectedTgId: 10 })).status, 400, 'Stale UI cannot dismiss a new message')
		assert.equal((await p.tgReplyReminder.findUniqueOrThrow({ where: { recipientId: recipient.id } })).anchorTgId, 11)
		const mark = await req(endpoint, { mark: 'HISTORY_DELETED', expectedTgId: 11 })
		assert.equal(mark.status, 200); assert.equal(mark.data.replyState, 'NO_REPLY_NEEDED')
		assert.equal((await p.tgDialogMessage.count({ where: { recipientId: recipient.id } })), 3, 'Marking history deleted must not delete any messages')
		assert.equal((await req(endpoint, { mark: null, expectedTgId: 11 })).data.conversationMark, null)
		assert.equal((await req(endpoint, { replyNeeded: true, expectedTgId: 11 })).data.replyState, 'NEEDS_REPLY')
		assert.equal((await req('/conversations?waiting=1')).data.counts.waiting, 1)
		await p.tgRecipient.update({ where: { id: recipient.id }, data: { peerStatus: 'long' } })
		assert.equal((await req('/conversations?waiting=1')).data.rows[0].conversationMark, null, 'Last seen long ago does not imply a block')
		await p.tgRecipient.update({ where: { id: recipient.id }, data: { peerDeleted: true } })
		assert.equal((await req('/conversations?waiting=1')).data.counts.waiting, 0)
		dialog = await req(`/recipients/${recipient.id}/dialog`)
		assert.equal(dialog.data.peerDeleted, true); assert.equal(dialog.data.replyState, 'NO_REPLY_NEEDED')
		assert.equal(alerts.length, 0, 'All tests must avoid real notifications')
		console.log('Conversation state: auth, validation, waiting counter/filter, read vs handled, reminder cancellation, new incoming, stale UI, manual marks, history preservation, reopen and deleted account checks passed')
	} finally {
		await app.close()
		await p.tgCampaign.delete({ where: { id: campaign.id } })
		await p.user.deleteMany({ where: { id: { in: [admin.id, manager.id] } } })
		await p.$disconnect()
	}
}
void main().catch(error => { console.error(error); process.exitCode = 1 })
