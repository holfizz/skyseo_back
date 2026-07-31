import {
	BadRequestException,
	ForbiddenException,
	Injectable,
	NotFoundException,
} from '@nestjs/common'
import { CrmTaskStatus, CrmUser, Prisma } from '@prisma/client'
import { ManagerService } from '../manager/manager.service'
import { PrismaService } from '../prisma/prisma.service'
import {
	CreateClientDto,
	CreateFunnelDto,
	CreateStageDto,
	CreateTaskDto,
	MoveTaskDto,
	ReminderInputDto,
	UpdateClientDto,
	UpdateFunnelDto,
	UpdateStageDto,
	UpdateTaskDto,
} from './dto'

// Человекочитаемая подпись смещения напоминания.
function humanizeOffset(min: number): string {
	if (min % (60 * 24) === 0) return `за ${min / (60 * 24)} дн.`
	if (min % 60 === 0) return `за ${min / 60} ч.`
	return `за ${min} мин.`
}

@Injectable()
export class CrmService {
	constructor(
		private prisma: PrismaService,
		private manager: ManagerService,
	) {}

	// ─── activity log (для админа: кто что делает) ──────────────────────────────
	private logActivity(
		actorId: string,
		action: string,
		entityType: string,
		entityId: string | null,
		summary: string,
		suspicious = false,
	) {
		return this.prisma.crmActivity
			.create({ data: { actorId, action, entityType, entityId, summary, suspicious } })
			.catch(() => undefined)
	}

	// ─── me / dashboard ─────────────────────────────────────────────────────────
	async me(user: CrmUser) {
		return user
	}

	async dashboard(user: CrmUser) {
		const now = new Date()
		const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
		const endOfToday = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000)

		const [clients, myClients, openTasks, overdue, dueToday, myTasks, reminders] =
			await Promise.all([
				this.prisma.crmClient.count(),
				this.prisma.crmClient.count({ where: { assigneeId: user.id } }),
				this.prisma.crmTask.count({ where: { status: { in: ['TODO', 'IN_PROGRESS'] } } }),
				this.prisma.crmTask.count({
					where: { assigneeId: user.id, status: { not: 'DONE' }, dueAt: { lt: now } },
				}),
				this.prisma.crmTask.count({
					where: {
						assigneeId: user.id,
						status: { not: 'DONE' },
						dueAt: { gte: startOfToday, lt: endOfToday },
					},
				}),
				this.prisma.crmTask.findMany({
					where: { assigneeId: user.id, status: { in: ['TODO', 'IN_PROGRESS'] } },
					include: { client: { select: { id: true, title: true } } },
					orderBy: [{ dueAt: 'asc' }, { priority: 'desc' }],
					take: 20,
				}),
				this.prisma.crmReminder.findMany({
					where: {
						sent: false,
						remindAt: { gt: now },
						OR: [{ targetId: user.id }, { task: { assigneeId: user.id } }],
					},
					include: { task: { select: { id: true, title: true } } },
					orderBy: { remindAt: 'asc' },
					take: 10,
				}),
			])

		return {
			stats: { clients, myClients, openTasks, overdue, dueToday },
			myTasks,
			reminders,
		}
	}

	// ─── clients ────────────────────────────────────────────────────────────────
	async listClients(query: { q?: string; status?: string; mine?: boolean; userId?: string }) {
		const where: Prisma.CrmClientWhereInput = {}
		if (query.status) where.status = query.status as any
		if (query.mine && query.userId) where.assigneeId = query.userId
		if (query.q) {
			const q = query.q.trim()
			where.OR = [
				{ title: { contains: q, mode: 'insensitive' } },
				{ company: { contains: q, mode: 'insensitive' } },
				{ email: { contains: q, mode: 'insensitive' } },
				{ phone: { contains: q, mode: 'insensitive' } },
				{ website: { contains: q, mode: 'insensitive' } },
			]
		}
		return this.prisma.crmClient.findMany({
			where,
			include: {
				assignee: { select: { id: true, firstName: true, username: true } },
				_count: { select: { tasks: true } },
			},
			orderBy: { updatedAt: 'desc' },
			take: 500,
		})
	}

	async getClient(id: string) {
		const client = await this.prisma.crmClient.findUnique({
			where: { id },
			include: {
				assignee: { select: { id: true, firstName: true, username: true } },
				createdBy: { select: { id: true, firstName: true, username: true } },
				tasks: {
					include: { reminders: true },
					orderBy: [{ status: 'asc' }, { position: 'asc' }],
				},
			},
		})
		if (!client) throw new NotFoundException('Клиент не найден')
		return client
	}

	async createClient(user: CrmUser, dto: CreateClientDto) {
		await this.assertAssignee(dto.assigneeId)
		const client = await this.prisma.crmClient.create({
			data: {
				title: dto.title.trim(),
				company: dto.company,
				phone: dto.phone,
				email: dto.email,
				telegram: dto.telegram,
				website: dto.website,
				status: dto.status ?? 'LEAD',
				notes: dto.notes,
				userId: dto.userId || null,
				assigneeId: dto.assigneeId || null,
				createdById: user.id,
			},
		})
		this.logActivity(user.id, 'client.create', 'client', client.id, `Создан клиент «${client.title}»`)
		return client
	}

	async updateClient(user: CrmUser, id: string, dto: UpdateClientDto) {
		const existing = await this.prisma.crmClient.findUnique({ where: { id } })
		if (!existing) throw new NotFoundException('Клиент не найден')
		if (dto.assigneeId) await this.assertAssignee(dto.assigneeId)

		const data: Prisma.CrmClientUpdateInput = {}
		if (dto.title !== undefined) data.title = dto.title.trim()
		if (dto.company !== undefined) data.company = dto.company
		if (dto.phone !== undefined) data.phone = dto.phone
		if (dto.email !== undefined) data.email = dto.email
		if (dto.telegram !== undefined) data.telegram = dto.telegram
		if (dto.website !== undefined) data.website = dto.website
		if (dto.status !== undefined) data.status = dto.status
		if (dto.notes !== undefined) data.notes = dto.notes
		if (dto.userId !== undefined) data.userId = dto.userId || null
		if (dto.assigneeId !== undefined)
			data.assignee = dto.assigneeId
				? { connect: { id: dto.assigneeId } }
				: { disconnect: true }

		const client = await this.prisma.crmClient.update({ where: { id }, data })
		const suspicious = existing.createdById != null && existing.createdById !== user.id
		this.logActivity(
			user.id,
			'client.update',
			'client',
			id,
			`Изменён клиент «${client.title}»`,
			suspicious,
		)
		return client
	}

	async deleteClient(user: CrmUser, id: string) {
		const existing = await this.prisma.crmClient.findUnique({ where: { id } })
		if (!existing) throw new NotFoundException('Клиент не найден')
		await this.prisma.crmClient.delete({ where: { id } })
		const suspicious = existing.createdById != null && existing.createdById !== user.id
		this.logActivity(
			user.id,
			'client.delete',
			'client',
			id,
			`Удалён клиент «${existing.title}»`,
			suspicious,
		)
		return { ok: true }
	}

	// Позиции/визиты клиента из платформы (если карточка связана с аккаунтом users.id).
	async getClientPositions(id: string) {
		const client = await this.prisma.crmClient.findUnique({ where: { id } })
		if (!client) throw new NotFoundException('Клиент не найден')
		if (!client.userId) return { linked: false as const }
		const [detail, trend, logs] = await Promise.all([
			this.manager.getClient(client.userId).catch(() => null),
			this.manager.getClientTrend(client.userId).catch(() => null),
			this.manager.getClientLogs(client.userId, 60).catch(() => null),
		])
		if (!detail) return { linked: false as const, notFound: true }
		return { linked: true as const, detail, trend, logs }
	}

	// Поиск аккаунтов платформы для привязки к карточке.
	async searchAccounts(q: string) {
		const term = (q || '').trim()
		if (term.length < 2) return []
		const users = await this.prisma.user.findMany({
			where: { email: { contains: term, mode: 'insensitive' } },
			select: {
				id: true,
				email: true,
				createdAt: true,
				balance: true,
				_count: { select: { websites: true } },
			},
			orderBy: { createdAt: 'desc' },
			take: 10,
		})
		return users.map(u => ({
			id: u.id,
			email: u.email,
			createdAt: u.createdAt,
			balance: u.balance,
			sites: u._count.websites,
		}))
	}

	// ─── tasks (kanban) ─────────────────────────────────────────────────────────
	async listTasks(query: { status?: string; clientId?: string; assigneeId?: string; mine?: boolean; userId?: string }) {
		const where: Prisma.CrmTaskWhereInput = {}
		if (query.status) where.status = query.status as any
		if (query.clientId) where.clientId = query.clientId
		if (query.assigneeId) where.assigneeId = query.assigneeId
		if (query.mine && query.userId) where.assigneeId = query.userId
		return this.prisma.crmTask.findMany({
			where,
			include: {
				client: { select: { id: true, title: true } },
				assignee: { select: { id: true, firstName: true, username: true } },
				reminders: { orderBy: { remindAt: 'asc' } },
			},
			orderBy: [{ status: 'asc' }, { position: 'asc' }],
			take: 1000,
		})
	}

	async getTask(id: string) {
		const task = await this.prisma.crmTask.findUnique({
			where: { id },
			include: {
				client: { select: { id: true, title: true } },
				assignee: { select: { id: true, firstName: true, username: true } },
				createdBy: { select: { id: true, firstName: true, username: true } },
				reminders: { orderBy: { remindAt: 'asc' }, include: { target: { select: { id: true, firstName: true } } } },
			},
		})
		if (!task) throw new NotFoundException('Задача не найдена')
		return task
	}

	async createTask(user: CrmUser, dto: CreateTaskDto) {
		const dueAt = this.parseFutureDate(dto.dueAt, 'Дедлайн')
		if (dto.assigneeId) await this.assertAssignee(dto.assigneeId)
		if (dto.clientId) await this.assertClient(dto.clientId)
		const status = dto.status ?? 'TODO'

		// В конец колонки.
		const last = await this.prisma.crmTask.findFirst({
			where: { status },
			orderBy: { position: 'desc' },
			select: { position: true },
		})
		const position = (last?.position ?? -1) + 1

		const task = await this.prisma.crmTask.create({
			data: {
				title: dto.title.trim(),
				description: dto.description,
				status,
				priority: dto.priority ?? 0,
				dueAt,
				position,
				clientId: dto.clientId || null,
				assigneeId: dto.assigneeId || null,
				createdById: user.id,
				completedAt: status === 'DONE' ? new Date() : null,
			},
		})

		if (dto.reminders?.length) {
			await this.createReminders(task.id, dueAt, dto.reminders)
		}

		this.logActivity(user.id, 'task.create', 'task', task.id, `Создана задача «${task.title}»`)
		return this.getTask(task.id)
	}

	async updateTask(user: CrmUser, id: string, dto: UpdateTaskDto) {
		const existing = await this.prisma.crmTask.findUnique({ where: { id } })
		if (!existing) throw new NotFoundException('Задача не найдена')
		if (dto.assigneeId) await this.assertAssignee(dto.assigneeId)
		if (dto.clientId) await this.assertClient(dto.clientId)

		const data: Prisma.CrmTaskUpdateInput = {}
		if (dto.title !== undefined) data.title = dto.title.trim()
		if (dto.description !== undefined) data.description = dto.description
		if (dto.priority !== undefined) data.priority = dto.priority
		if (dto.dueAt !== undefined)
			data.dueAt = dto.dueAt ? this.parseFutureDate(dto.dueAt, 'Дедлайн') : null
		if (dto.clientId !== undefined)
			data.client = dto.clientId ? { connect: { id: dto.clientId } } : { disconnect: true }
		if (dto.assigneeId !== undefined)
			data.assignee = dto.assigneeId ? { connect: { id: dto.assigneeId } } : { disconnect: true }
		if (dto.status !== undefined) {
			data.status = dto.status
			data.completedAt =
				dto.status === 'DONE'
					? existing.completedAt ?? new Date()
					: null
		}

		await this.prisma.crmTask.update({ where: { id }, data })
		const suspicious =
			existing.assigneeId != null &&
			existing.assigneeId !== user.id &&
			existing.createdById !== user.id
		this.logActivity(user.id, 'task.update', 'task', id, `Изменена задача «${existing.title}»`, suspicious)
		return this.getTask(id)
	}

	// Перенос задачи между колонками / изменение порядка (drag-and-drop).
	async moveTask(user: CrmUser, id: string, dto: MoveTaskDto) {
		const task = await this.prisma.crmTask.findUnique({ where: { id } })
		if (!task) throw new NotFoundException('Задача не найдена')

		await this.prisma.$transaction(async tx => {
			// Сериализуем одновременные перемещения в одну колонку: блокируем её строки,
			// чтобы второй move пересчитывал позиции уже после коммита первого (без lost-update).
			await tx.$queryRaw`SELECT id FROM crm_tasks WHERE status = ${dto.status}::"CrmTaskStatus" FOR UPDATE`
			const siblings = await tx.crmTask.findMany({
				where: { status: dto.status, id: { not: id } },
				orderBy: { position: 'asc' },
				select: { id: true },
			})
			const clamped = Math.max(0, Math.min(dto.position, siblings.length))
			const ordered = [...siblings.slice(0, clamped), { id }, ...siblings.slice(clamped)]
			for (let i = 0; i < ordered.length; i++) {
				if (ordered[i].id === id) {
					await tx.crmTask.update({
						where: { id },
						data: {
							status: dto.status,
							position: i,
							completedAt:
								dto.status === 'DONE'
									? task.completedAt ?? new Date()
									: task.status === 'DONE'
										? null
										: task.completedAt,
						},
					})
				} else {
					await tx.crmTask.update({ where: { id: ordered[i].id }, data: { position: i } })
				}
			}
		})
		this.logActivity(user.id, 'task.move', 'task', id, `«${task.title}» → ${dto.status}`)
		return { ok: true }
	}

	async deleteTask(user: CrmUser, id: string) {
		const existing = await this.prisma.crmTask.findUnique({ where: { id } })
		if (!existing) throw new NotFoundException('Задача не найдена')
		await this.prisma.crmTask.delete({ where: { id } })
		const suspicious =
			existing.createdById != null && existing.createdById !== user.id
		this.logActivity(user.id, 'task.delete', 'task', id, `Удалена задача «${existing.title}»`, suspicious)
		return { ok: true }
	}

	// ─── reminders ──────────────────────────────────────────────────────────────
	async addReminder(user: CrmUser, taskId: string, dto: ReminderInputDto) {
		const task = await this.prisma.crmTask.findUnique({ where: { id: taskId } })
		if (!task) throw new NotFoundException('Задача не найдена')
		const created = await this.createReminders(taskId, task.dueAt, [dto])
		if (!created.length)
			throw new BadRequestException('Напоминание в прошлом — время уже прошло')
		this.logActivity(user.id, 'reminder.create', 'reminder', created[0].id, `Напоминание к «${task.title}»`)
		return created[0]
	}

	async deleteReminder(user: CrmUser, id: string) {
		const existing = await this.prisma.crmReminder.findUnique({ where: { id } })
		if (!existing) throw new NotFoundException('Напоминание не найдено')
		await this.prisma.crmReminder.delete({ where: { id } })
		this.logActivity(user.id, 'reminder.delete', 'reminder', id, 'Удалено напоминание')
		return { ok: true }
	}

	// Считает абсолютное remindAt для каждого входа, отбрасывает прошедшие.
	private async createReminders(
		taskId: string,
		dueAt: Date | null,
		inputs: ReminderInputDto[],
	) {
		const now = Date.now()
		const rows: Prisma.CrmReminderCreateManyInput[] = []
		for (const r of inputs) {
			let remindAt: Date | null = null
			let label = r.label
			if (r.remindAt) {
				remindAt = new Date(r.remindAt)
			} else if (r.offsetMinutes != null) {
				if (!dueAt)
					throw new BadRequestException('Для напоминания «за N» нужен дедлайн задачи')
				remindAt = new Date(dueAt.getTime() - r.offsetMinutes * 60 * 1000)
				if (!label) label = humanizeOffset(r.offsetMinutes)
			}
			if (!remindAt || Number.isNaN(remindAt.getTime())) continue
			if (remindAt.getTime() <= now) continue // прошедшие не создаём
			if (r.targetId) await this.assertAssignee(r.targetId)
			rows.push({ taskId, remindAt, offsetLabel: label ?? null, targetId: r.targetId || null })
		}
		if (!rows.length) return []
		await this.prisma.crmReminder.createMany({ data: rows })
		return this.prisma.crmReminder.findMany({
			where: { taskId, remindAt: { in: rows.map(r => r.remindAt as Date) } },
			orderBy: { remindAt: 'asc' },
		})
	}

	// ─── calendar ───────────────────────────────────────────────────────────────
	async calendar(from: string, to: string) {
		const fromDate = from ? new Date(from) : new Date()
		const toDate = to ? new Date(to) : new Date(fromDate.getTime() + 31 * 24 * 60 * 60 * 1000)
		if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime()))
			throw new BadRequestException('Некорректный диапазон дат')

		const tasks = await this.prisma.crmTask.findMany({
			where: { dueAt: { gte: fromDate, lte: toDate } },
			include: {
				client: { select: { id: true, title: true } },
				assignee: { select: { id: true, firstName: true } },
			},
			orderBy: { dueAt: 'asc' },
			take: 1000,
		})
		return tasks.map(t => ({
			id: t.id,
			title: t.title,
			dueAt: t.dueAt,
			status: t.status,
			priority: t.priority,
			client: t.client,
			assignee: t.assignee,
		}))
	}

	// Лёгкий список участников для выпадашек «ответственный» (доступен всем в CRM).
	async membersLite() {
		return this.prisma.crmUser.findMany({
			where: { isActive: true },
			select: { id: true, firstName: true, username: true, role: true },
			orderBy: [{ role: 'asc' }, { firstName: 'asc' }],
		})
	}

	// ─── team / activity (admin) ────────────────────────────────────────────────
	async members() {
		const users = await this.prisma.crmUser.findMany({
			orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
		})
		const counts = await Promise.all(
			users.map(async u => {
				const [clients, openTasks, doneTasks] = await Promise.all([
					this.prisma.crmClient.count({ where: { assigneeId: u.id } }),
					this.prisma.crmTask.count({ where: { assigneeId: u.id, status: { not: 'DONE' } } }),
					this.prisma.crmTask.count({ where: { assigneeId: u.id, status: 'DONE' } }),
				])
				return { ...u, clients, openTasks, doneTasks }
			}),
		)
		return counts
	}

	async activity(query: { limit?: number; suspicious?: boolean }) {
		const take = Math.min(Math.max(Number(query.limit) || 100, 1), 300)
		return this.prisma.crmActivity.findMany({
			where: query.suspicious ? { suspicious: true } : {},
			include: { actor: { select: { id: true, firstName: true, username: true } } },
			orderBy: { createdAt: 'desc' },
			take,
		})
	}

	// ─── funnels (пайплайны) ────────────────────────────────────────────────────
	async listFunnels() {
		return this.prisma.crmFunnel.findMany({
			orderBy: { position: 'asc' },
			include: {
				stages: {
					orderBy: { position: 'asc' },
					include: { _count: { select: { clients: true } } },
				},
				_count: { select: { clients: true } },
			},
		})
	}

	async funnelBoard(id: string) {
		const funnel = await this.prisma.crmFunnel.findUnique({
			where: { id },
			include: {
				stages: {
					orderBy: { position: 'asc' },
					include: {
						clients: {
							orderBy: { updatedAt: 'desc' },
							include: { assignee: { select: { id: true, firstName: true, username: true } } },
						},
					},
				},
			},
		})
		if (!funnel) throw new NotFoundException('Воронка не найдена')
		return funnel
	}

	async createFunnel(user: CrmUser, dto: CreateFunnelDto) {
		const last = await this.prisma.crmFunnel.findFirst({ orderBy: { position: 'desc' }, select: { position: true } })
		const funnel = await this.prisma.crmFunnel.create({
			data: {
				name: dto.name.trim(),
				color: dto.color || null,
				position: (last?.position ?? -1) + 1,
				createdById: user.id,
				stages: dto.stages?.length
					? { create: dto.stages.map((s, i) => ({ title: s.title.trim(), color: s.color || '#a0b5ff', position: i })) }
					: undefined,
			},
			include: { stages: { orderBy: { position: 'asc' } } },
		})
		this.logActivity(user.id, 'funnel.create', 'funnel', funnel.id, `Создана воронка «${funnel.name}»`)
		return funnel
	}

	async updateFunnel(user: CrmUser, id: string, dto: UpdateFunnelDto) {
		await this.assertFunnel(id)
		const data: Prisma.CrmFunnelUpdateInput = {}
		if (dto.name !== undefined) data.name = dto.name.trim()
		if (dto.color !== undefined) data.color = dto.color || null
		const funnel = await this.prisma.crmFunnel.update({ where: { id }, data })
		this.logActivity(user.id, 'funnel.update', 'funnel', id, `Изменена воронка «${funnel.name}»`)
		return funnel
	}

	async deleteFunnel(user: CrmUser, id: string) {
		const f = await this.prisma.crmFunnel.findUnique({ where: { id } })
		if (!f) throw new NotFoundException('Воронка не найдена')
		await this.prisma.crmFunnel.delete({ where: { id } }) // этапы — cascade; у клиентов funnelId/stageId → null
		this.logActivity(user.id, 'funnel.delete', 'funnel', id, `Удалена воронка «${f.name}»`)
		return { ok: true }
	}

	async addStage(user: CrmUser, funnelId: string, dto: CreateStageDto) {
		await this.assertFunnel(funnelId)
		const last = await this.prisma.crmFunnelStage.findFirst({
			where: { funnelId },
			orderBy: { position: 'desc' },
			select: { position: true },
		})
		const stage = await this.prisma.crmFunnelStage.create({
			data: { funnelId, title: dto.title.trim(), color: dto.color || '#a0b5ff', position: (last?.position ?? -1) + 1 },
		})
		this.logActivity(user.id, 'stage.create', 'funnel', funnelId, `Этап «${stage.title}»`)
		return stage
	}

	async updateStage(user: CrmUser, id: string, dto: UpdateStageDto) {
		const existing = await this.prisma.crmFunnelStage.findUnique({ where: { id } })
		if (!existing) throw new NotFoundException('Этап не найден')
		const data: Prisma.CrmFunnelStageUpdateInput = {}
		if (dto.title !== undefined) data.title = dto.title.trim()
		if (dto.color !== undefined) data.color = dto.color || '#a0b5ff'
		return this.prisma.crmFunnelStage.update({ where: { id }, data })
	}

	async moveStage(user: CrmUser, id: string, position: number) {
		const stage = await this.prisma.crmFunnelStage.findUnique({ where: { id } })
		if (!stage) throw new NotFoundException('Этап не найден')
		await this.prisma.$transaction(async tx => {
			await tx.$queryRaw`SELECT id FROM crm_funnel_stages WHERE "funnelId" = ${stage.funnelId} FOR UPDATE`
			const sibs = await tx.crmFunnelStage.findMany({
				where: { funnelId: stage.funnelId, id: { not: id } },
				orderBy: { position: 'asc' },
				select: { id: true },
			})
			const clamped = Math.max(0, Math.min(position, sibs.length))
			const ordered = [...sibs.slice(0, clamped), { id }, ...sibs.slice(clamped)]
			for (let i = 0; i < ordered.length; i++) {
				await tx.crmFunnelStage.update({ where: { id: ordered[i].id }, data: { position: i } })
			}
		})
		return { ok: true }
	}

	async deleteStage(user: CrmUser, id: string) {
		const s = await this.prisma.crmFunnelStage.findUnique({ where: { id } })
		if (!s) throw new NotFoundException('Этап не найден')
		await this.prisma.crmFunnelStage.delete({ where: { id } }) // у клиентов stageId → null
		this.logActivity(user.id, 'stage.delete', 'funnel', s.funnelId, `Удалён этап «${s.title}»`)
		return { ok: true }
	}

	// Перенос клиента на этап (drag-and-drop на доске воронки). Пустой stageId → убрать из воронки.
	async moveClientStage(user: CrmUser, clientId: string, stageId?: string) {
		const client = await this.prisma.crmClient.findUnique({ where: { id: clientId }, select: { id: true } })
		if (!client) throw new NotFoundException('Клиент не найден')
		if (!stageId) {
			await this.prisma.crmClient.update({ where: { id: clientId }, data: { stageId: null, funnelId: null } })
			this.logActivity(user.id, 'client.stage', 'client', clientId, 'Клиент убран из воронки')
			return { ok: true }
		}
		const stage = await this.prisma.crmFunnelStage.findUnique({ where: { id: stageId }, select: { id: true, funnelId: true, title: true } })
		if (!stage) throw new BadRequestException('Этап не найден')
		await this.prisma.crmClient.update({
			where: { id: clientId },
			data: { stageId: stage.id, funnelId: stage.funnelId },
		})
		this.logActivity(user.id, 'client.stage', 'client', clientId, `Клиент → этап «${stage.title}»`)
		return { ok: true }
	}

	private async assertFunnel(id: string) {
		const f = await this.prisma.crmFunnel.findUnique({ where: { id }, select: { id: true } })
		if (!f) throw new NotFoundException('Воронка не найдена')
	}

	// ─── helpers ────────────────────────────────────────────────────────────────
	private parseFutureDate(value: string | undefined | null, field: string): Date | null {
		if (!value) return null
		const d = new Date(value)
		if (Number.isNaN(d.getTime())) throw new BadRequestException(`${field}: некорректная дата`)
		if (d.getTime() < Date.now() - 60 * 1000)
			throw new BadRequestException(`${field} не может быть в прошлом`)
		return d
	}

	private async assertAssignee(id?: string | null) {
		if (!id) return
		const u = await this.prisma.crmUser.findUnique({ where: { id }, select: { id: true } })
		if (!u) throw new BadRequestException('Ответственный не найден в CRM')
	}

	private async assertClient(id?: string | null) {
		if (!id) return
		const c = await this.prisma.crmClient.findUnique({ where: { id }, select: { id: true } })
		if (!c) throw new BadRequestException('Клиент не найден')
	}
}
