import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { CrmTask, Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'

type RecipientFollowUpInput = {
	recipientId: string
	actorId?: string | null
	dueAt?: Date | null
	note?: string | null
	outcome?: string | null
}

/** CRM task is canonical. Legacy Telegram fields are a transactional projection. */
@Injectable()
export class FollowUpService {
	constructor(private readonly prisma: PrismaService) {}

	async saveRecipient(input: RecipientFollowUpInput) {
		if (input.dueAt && Number.isNaN(input.dueAt.getTime()))
			throw new BadRequestException('Некорректная дата напоминания')
		return this.prisma.$transaction(async tx => {
			// One recipient can only have one active follow-up. Serialize concurrent edits.
			await tx.$queryRaw`SELECT id FROM tg_recipients WHERE id = ${input.recipientId} FOR UPDATE`
			const recipient = await tx.tgRecipient.findUnique({
				where: { id: input.recipientId },
				select: {
					id: true, crmLeadId: true, firstName: true, middleName: true,
					username: true, phone: true, domain: true, followUpAt: true,
					followUpNote: true, followUpNotifiedAt: true, outcome: true,
				},
			})
			if (!recipient) throw new NotFoundException('Адресат не найден')

			const dueAt = input.dueAt === undefined ? recipient.followUpAt : input.dueAt
			const note = input.dueAt === null
				? null
				: input.note === undefined ? recipient.followUpNote : input.note?.trim().slice(0, 300) || null
			const dateChanged = recipient.followUpAt?.getTime() !== dueAt?.getTime()
			const data: Prisma.TgRecipientUpdateInput = {}
			if (input.outcome !== undefined) {
				data.outcome = input.outcome
				if (input.outcome !== recipient.outcome)
					data.outcomeAt = input.outcome ? new Date() : null
			}
			if (input.dueAt !== undefined || input.note !== undefined) {
				data.followUpAt = dueAt
				data.followUpNote = note
				if (dateChanged) data.followUpNotifiedAt = null
			}
			if (Object.keys(data).length) await tx.tgRecipient.update({ where: { id: recipient.id }, data })

			if (input.dueAt === undefined && input.note === undefined) return { ok: true }
			const current = await tx.crmTask.findUnique({ where: { followUpRecipientId: recipient.id } })
			if (current && current.kind !== 'FOLLOW_UP')
				throw new BadRequestException('Диалог связан с задачей другого типа')
			if (!dueAt) {
				if (current) {
					await tx.crmTask.update({ where: { id: current.id }, data: { status: 'DONE', completedAt: new Date(), dueAt: null } })
					await tx.crmReminder.deleteMany({ where: { taskId: current.id, offsetLabel: 'follow-up', sent: false } })
					if (input.actorId) await tx.crmActivity.create({ data: { actorId: input.actorId, action: 'follow_up.close', entityType: 'task', entityId: current.id, summary: 'Follow-up закрыт' } })
				}
				return { ok: true }
			}

			const who = [recipient.firstName, recipient.middleName].filter(Boolean).join(' ')
				|| (recipient.username ? `@${recipient.username}` : recipient.phone)
				|| recipient.domain || 'контакту'
			const title = `Написать ${who}`.slice(0, 200)
			const task = current
				? await tx.crmTask.update({
					where: { id: current.id },
					data: {
						title, description: note, dueAt, leadId: recipient.crmLeadId,
						status: 'TODO', completedAt: null,
					},
				})
				: await tx.crmTask.create({
					data: {
						kind: 'FOLLOW_UP', title, description: note, dueAt,
						leadId: recipient.crmLeadId,
						followUpRecipientId: recipient.id,
					},
				})
			if (dateChanged || !current) {
				await this.replaceReminder(tx, task, recipient.followUpNotifiedAt !== null && !dateChanged)
			}
			if (input.actorId) await tx.crmActivity.create({ data: { actorId: input.actorId, action: 'follow_up.save', entityType: 'task', entityId: task.id, summary: 'Follow-up сохранён' } })
			return { ok: true, taskId: task.id }
		})
	}

	async saveCrm(input: {
		taskId?: string
		leadId: string
		recipientId?: string | null
		dueAt: Date | null
		note?: string | null
		actorId?: string | null
	}) {
		if (input.recipientId) {
			const recipient = await this.prisma.tgRecipient.findUnique({
				where: { id: input.recipientId }, select: { crmLeadId: true },
			})
			if (!recipient || recipient.crmLeadId !== input.leadId)
				throw new BadRequestException('Диалог не принадлежит CRM-лиду')
			return this.saveRecipient({ recipientId: input.recipientId, dueAt: input.dueAt, note: input.note, actorId: input.actorId })
		}
		if (input.dueAt && Number.isNaN(input.dueAt.getTime()))
			throw new BadRequestException('Некорректная дата напоминания')
		return this.prisma.$transaction(async tx => {
			const lead = await tx.crmLead.findUnique({ where: { id: input.leadId }, select: { id: true, assigneeId: true, title: true } })
			if (!lead) throw new NotFoundException('Лид не найден')
			let current: CrmTask | null = null
			if (input.taskId) {
				current = await tx.crmTask.findUnique({ where: { id: input.taskId } })
				if (current && (current.kind !== 'FOLLOW_UP' || current.leadId !== lead.id || current.followUpRecipientId))
					throw new BadRequestException('Задача follow-up не принадлежит CRM-лиду')
			}
			if (!input.dueAt) {
				if (!current) throw new BadRequestException('Для нового follow-up нужна дата')
				await tx.crmTask.update({ where: { id: current.id }, data: { status: 'DONE', completedAt: new Date(), dueAt: null } })
				await tx.crmReminder.deleteMany({ where: { taskId: current.id, offsetLabel: 'follow-up', sent: false } })
				if (input.actorId) await tx.crmActivity.create({ data: { actorId: input.actorId, action: 'follow_up.close', entityType: 'task', entityId: current.id, summary: 'Follow-up закрыт' } })
				return { ok: true, taskId: current.id }
			}
			const note = input.note?.trim().slice(0, 300) || null
			const task = current
				? await tx.crmTask.update({ where: { id: current.id }, data: { dueAt: input.dueAt, description: note, status: 'TODO', completedAt: null } })
				: await tx.crmTask.create({ data: {
					...(input.taskId ? { id: input.taskId } : {}),
					kind: 'FOLLOW_UP', title: `Связаться: ${lead.title}`.slice(0, 200),
					description: note, dueAt: input.dueAt, leadId: lead.id,
					assigneeId: lead.assigneeId, createdById: input.actorId || null,
				} })
			if (!current || current.dueAt?.getTime() !== input.dueAt.getTime())
				await this.replaceReminder(tx, task, false)
			if (input.actorId) await tx.crmActivity.create({ data: { actorId: input.actorId, action: 'follow_up.save', entityType: 'task', entityId: task.id, summary: 'Follow-up сохранён' } })
			return { ok: true, taskId: task.id }
		})
	}

	private async replaceReminder(tx: Prisma.TransactionClient, task: CrmTask, alreadyNotified: boolean) {
		await tx.crmReminder.deleteMany({ where: { taskId: task.id, offsetLabel: 'follow-up', sent: false } })
		if (!task.dueAt) return
		await tx.crmReminder.create({ data: {
			taskId: task.id, remindAt: task.dueAt, offsetLabel: 'follow-up',
			sent: alreadyNotified, sentAt: alreadyNotified ? new Date() : null,
		} })
	}
}
