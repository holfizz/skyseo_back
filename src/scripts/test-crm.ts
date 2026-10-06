/** Integration smoke test. Run only against a migrated, disposable *_test database. */
import 'reflect-metadata'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { CrmService } from '../crm/crm.service'
import { FollowUpService } from '../crm/follow-up.service'
import { QualificationService } from '../crm/qualification.service'
import { PrismaService } from '../prisma/prisma.service'
import { ManagerService } from '../manager/manager.service'

const url = process.env.CRM_TEST_DATABASE_URL
if (!url) throw new Error('Set CRM_TEST_DATABASE_URL to a migrated disposable *_test database')
const parsed = new URL(url)
if (!parsed.pathname.split('/').pop()?.endsWith('_test'))
	throw new Error('CRM integration test refuses a database without the _test suffix')

const prisma = new PrismaClient({ datasources: { db: { url } } })
const crm = new CrmService(prisma as PrismaService, {} as ManagerService)
const followUp = new FollowUpService(prisma as PrismaService)
const qualification = new QualificationService(prisma as PrismaService)

async function main() {
	const defaultStage = await prisma.crmFunnelStage.findUnique({ where: { id: 'skyseo-sales-new' } })
	assert.ok(defaultStage, 'Apply the CRM migration to the test database first')
	const actor = await prisma.crmUser.create({ data: { role: 'ADMIN', email: 'crm-smoke@example.test' } })
	const other = await prisma.crmUser.create({ data: { role: 'EMPLOYEE', email: 'crm-smoke-other@example.test' } })
	const campaign = await prisma.tgCampaign.create({ data: { name: 'CRM smoke', firstMessage: 'Test' } })
	const outreach = await prisma.outreachLead.create({ data: { domain: 'crm-smoke.example', message: 'Test' } })
	const [first, second] = await Promise.all([1, 2].map(i => prisma.tgRecipient.create({
		data: { campaignId: campaign.id, leadId: outreach.id, username: `crmsmoke${outreach.id.slice(0, 8)}${i}` },
	})))

	// Two dialogs of one company can race without producing duplicate CRM leads.
	const [fromFirst, fromSecond] = await Promise.all([
		crm.ensureLeadFromRecipient(actor, first.id), crm.ensureLeadFromRecipient(actor, second.id),
	])
	assert.equal(fromFirst.id, fromSecond.id)
	const lead = await prisma.crmLead.findUniqueOrThrow({
		where: { id: fromFirst.id }, include: { recipients: true },
	})
	assert.equal(lead.outreachLeadId, outreach.id)
	assert.equal(lead.recipients.length, 2)
	assert.ok([first.id, second.id].includes(lead.sourceRecipientId || ''))
	assert.equal(await prisma.crmLead.count({ where: { outreachLeadId: outreach.id } }), 1)

	const third = await prisma.tgRecipient.create({ data: {
		campaignId: campaign.id, leadId: outreach.id, username: `crmsmoke${outreach.id.slice(0, 8)}3`,
	} })
	await assert.rejects(() => crm.ensureLeadFromRecipient(other, third.id), /другим сотрудником/)
	const otherFunnel = await prisma.crmFunnel.create({ data: { name: 'CRM smoke other funnel' } })
	const wrongStage = await prisma.crmFunnelStage.create({ data: { funnelId: otherFunnel.id, title: 'Wrong stage' } })
	await assert.rejects(() => crm.moveLeadStage(actor, lead.id, wrongStage.id), /другой воронке/)

	const dueAt = new Date(Date.now() + 86_400_000)
	await followUp.saveRecipient({ recipientId: first.id, dueAt, note: 'Вернуться к клиенту' })
	const task = await prisma.crmTask.findUniqueOrThrow({ where: { followUpRecipientId: first.id } })
	assert.equal(task.kind, 'FOLLOW_UP')
	assert.equal(task.leadId, lead.id)
	assert.equal((await prisma.tgRecipient.findUniqueOrThrow({ where: { id: first.id } })).followUpAt?.getTime(), dueAt.getTime())
	assert.equal(await prisma.crmReminder.count({ where: { taskId: task.id, sent: false } }), 1)
	await followUp.saveRecipient({ recipientId: first.id, dueAt: null })
	assert.equal((await prisma.tgRecipient.findUniqueOrThrow({ where: { id: first.id } })).followUpAt, null)
	assert.equal((await prisma.crmTask.findUniqueOrThrow({ where: { id: task.id } })).status, 'DONE')
	assert.equal(await prisma.crmReminder.count({ where: { taskId: task.id, sent: false } }), 0)

	const follow = await followUp.saveCrm({ leadId: lead.id, dueAt, note: 'Получить решение' })
	assert.equal(await prisma.crmReminder.count({ where: { taskId: follow.taskId, sent: false } }), 1)
	await followUp.saveCrm({ leadId: lead.id, taskId: follow.taskId, dueAt: null })
	assert.equal(await prisma.crmReminder.count({ where: { taskId: follow.taskId, sent: false } }), 0)

	const requestId = randomUUID()
	const [call, repeatedCall] = await Promise.all([
		crm.scheduleCall(actor, lead.id, { requestId, title: 'Созвон', dueAt: dueAt.toISOString() }),
		crm.scheduleCall(actor, lead.id, { requestId, title: 'Созвон', dueAt: dueAt.toISOString() }),
	])
	assert.equal(call.id, repeatedCall.id)
	assert.equal(await prisma.crmTask.count({ where: { id: requestId } }), 1)
	await crm.updateTask(actor, call.id, { status: 'DONE' })
	assert.equal(await prisma.crmReminder.count({ where: { taskId: call.id, sent: false } }), 0)

	const custom = await qualification.createField({
		key: `smoke_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
		name: 'Есть маркетолог?', type: 'BOOLEAN', required: true,
	})
	await assert.rejects(() => crm.qualifyLead(actor, lead.id, {}), /Есть маркетолог/)
	await qualification.saveValue(lead.id, custom.id, false, actor.id)
	assert.equal((await qualification.leadFields(lead.id)).values.find(v => v.fieldId === custom.id)?.valueBoolean, false)
	const filtered = await crm.leadPage({ customFieldId: custom.id, customValue: 'false' }, actor)
	assert.ok(filtered.rows.some(row => row.id === lead.id))
	await qualification.updateField(custom.id, { isActive: false })
	assert.equal((await prisma.crmCustomFieldValue.findUniqueOrThrow({ where: { fieldId_leadId: { fieldId: custom.id, leadId: lead.id } } })).valueBoolean, false)
	await qualification.updateField(custom.id, { isActive: true })
	const select = await qualification.createField({
		key: `smoke_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
		name: 'Срок ожидания', type: 'SELECT', options: ['1 месяц', '3 месяца'],
	})
	await qualification.saveValue(lead.id, select.id, '3 месяца', actor.id)
	assert.ok((await crm.leadPage({ customFieldId: select.id, customValue: '3 месяца' }, actor)).rows.some(row => row.id === lead.id))
	await assert.rejects(() => qualification.updateField(select.id, { options: ['1 месяц'] }), /сохранённые ответы/)
	const number = await qualification.createField({
		key: `smoke_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
		name: 'Средний чек', type: 'NUMBER',
	})
	await qualification.saveValue(lead.id, number.id, 75000, actor.id)
	assert.ok((await crm.leadPage({ customFieldId: number.id, customValue: '50000' }, actor)).rows.some(row => row.id === lead.id))
	const multi = await qualification.createField({
		key: `smoke_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
		name: 'Каналы', type: 'MULTI_SELECT', options: ['Поиск', 'Рекомендации'],
	})
	await qualification.saveValue(lead.id, multi.id, ['Поиск', 'Рекомендации'], actor.id)
	assert.ok((await crm.leadPage({ customFieldId: multi.id, customValue: 'Поиск' }, actor)).rows.some(row => row.id === lead.id))
	await Promise.all([
		crm.updateLead(actor, lead.id, { qualification: { hasSeo: 'YES' } }),
		crm.updateLead(actor, lead.id, { qualification: { needsSeo: 'YES' } }),
	])
	const answers = (await prisma.crmLead.findUniqueOrThrow({ where: { id: lead.id } })).qualification as Record<string, string>
	assert.equal(answers.hasSeo, 'YES')
	assert.equal(answers.needsSeo, 'YES')
	assert.ok((await crm.leadPage({ isDecisionMaker: undefined, hasSeo: 'YES' }, actor)).rows.some(row => row.id === lead.id))

	const qualified = await crm.qualifyLead(actor, lead.id, {})
	const again = await crm.qualifyLead(actor, lead.id, {})
	await qualification.updateField(custom.id, { isActive: false })
	assert.equal(qualified.client.id, again.client.id)
	assert.equal(qualified.deal?.id, again.deal?.id)
	assert.equal(await prisma.crmDeal.count({ where: { leadId: lead.id } }), 1)
	await assert.rejects(() => crm.updateDeal(actor, qualified.deal!.id, { status: 'LOST' }), /причину/)
	await crm.updateDeal(actor, qualified.deal!.id, { status: 'LOST', lostReason: 'NOT_NOW' })
	await crm.updateDeal(actor, qualified.deal!.id, { status: 'WON' })
	assert.equal((await prisma.crmClient.findUniqueOrThrow({ where: { id: qualified.client.id } })).status, 'ACTIVE')
	console.log('CRM integration smoke passed: relations, follow-ups, qualification, custom fields, filters, permissions, one deal')
}

main().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => prisma.$disconnect())
