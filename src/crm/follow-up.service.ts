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

export type StandaloneFollowUpInput = {
	taskId?: string
	leadId?: string | null
	name?: string | null
	contact?: string | null
	website?: string | null
	note?: string | null
	source?: 'MANUAL' | 'SITE_FORM'
	dueAt: Date
}

/** CRM task is canonical. Legacy Telegram fields are a transactional projection. */
@Injectable()
export class FollowUpService {
	constructor(private readonly prisma: PrismaService) {}

	/** Напоминание может жить само по себе; CRM-лид и Telegram-диалог необязательны. */
	async saveStandalone(input: StandaloneFollowUpInput) {
		for (const value of [input.taskId, input.leadId, input.name, input.contact, input.website, input.note]) {
			if (value !== undefined && value !== null && typeof value !== 'string')
				throw new BadRequestException('Некорректные данные напоминания')
		}
		if (!(input.dueAt instanceof Date) || Number.isNaN(input.dueAt.getTime()))
			throw new BadRequestException('Укажите корректную дату напоминания')
		if (input.dueAt.getTime() < Date.now() - 60_000)
			throw new BadRequestException('Дата напоминания уже прошла')
		if (input.source && !['MANUAL', 'SITE_FORM'].includes(input.source))
			throw new BadRequestException('Неизвестный источник контакта')
		const name = input.name?.trim().slice(0, 160) || null
		const contact = input.contact?.trim().slice(0, 200) || null
		const website = input.website?.trim().slice(0, 200) || null
		const note = input.note?.trim().slice(0, 2000) || null
		return this.prisma.$transaction(async tx => {
			let current: CrmTask | null = null
			if (input.taskId) {
				await tx.$queryRaw`SELECT id FROM crm_tasks WHERE id = ${input.taskId} FOR UPDATE`
				current = await tx.crmTask.findUnique({ where: { id: input.taskId } })
				if (!current || current.kind !== 'FOLLOW_UP' || current.followUpRecipientId)
					throw new NotFoundException('Свободное напоминание не найдено')
			}
			const leadId = input.leadId === undefined ? current?.leadId ?? null : input.leadId
			if (leadId) await tx.$queryRaw`SELECT id FROM crm_leads WHERE id = ${leadId} FOR UPDATE`
			const lead = leadId ? await tx.crmLead.findUnique({ where: { id: leadId }, select: { id: true, title: true, contact: true, source: true, assigneeId: true } }) : null
			if (leadId && (!lead || lead.source !== 'SITE_FORM')) throw new BadRequestException('Заявка с сайта не найдена')
			if (leadId && input.source === 'MANUAL') throw new BadRequestException('Источник не совпадает с заявкой')
			if (!name && !contact && !website && !lead) throw new BadRequestException('Укажите имя, контакт или сайт')
			if (leadId) {
				const duplicate = await tx.crmTask.findFirst({ where: { leadId, kind: 'FOLLOW_UP', status: { in: ['TODO', 'IN_PROGRESS'] }, dueAt: { not: null }, ...(current ? { id: { not: current.id } } : {}) }, select: { id: true } })
				if (duplicate) throw new BadRequestException('Для этой заявки уже есть активное напоминание')
			}
			const who = name || lead?.title || contact || website || 'контакт'
			const data = {
				title: `Связаться: ${who}`.slice(0, 200), description: note, dueAt: input.dueAt,
				followUpName: name, followUpContact: contact, followUpWebsite: website,
				followUpSource: input.source ?? current?.followUpSource ?? (lead ? 'SITE_FORM' : 'MANUAL'),
				leadId,
			}
			const task = current
				? await tx.crmTask.update({ where: { id: current.id }, data: { ...data, status: 'TODO', completedAt: null } })
				: await tx.crmTask.create({ data: { ...data, kind: 'FOLLOW_UP', assigneeId: lead?.assigneeId ?? null } })
			if (!current || current.dueAt?.getTime() !== input.dueAt.getTime()) await this.replaceReminder(tx, task, false)
			return { ok: true, taskId: task.id }
		})
	}

	async completeStandalone(taskId: string) {
		return this.prisma.$transaction(async tx => {
			await tx.$queryRaw`SELECT id FROM crm_tasks WHERE id = ${taskId} FOR UPDATE`
			const task = await tx.crmTask.findUnique({ where: { id: taskId } })
			if (!task || task.kind !== 'FOLLOW_UP' || task.followUpRecipientId)
				throw new NotFoundException('Свободное напоминание не найдено')
			await tx.crmTask.update({ where: { id: task.id }, data: { status: 'DONE', completedAt: new Date(), dueAt: null } })
			await tx.crmReminder.deleteMany({ where: { taskId: task.id, sent: false } })
			return { ok: true }
		})
	}

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
