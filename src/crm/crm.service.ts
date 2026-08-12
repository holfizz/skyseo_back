import {
	BadRequestException,
	ForbiddenException,
	Injectable,
	NotFoundException,
} from '@nestjs/common'
import { rolesOf } from '../common/roles'
import { CrmTaskStatus, CrmUser, Prisma } from '@prisma/client'
import { ManagerService } from '../manager/manager.service'
import { PrismaService } from '../prisma/prisma.service'
import {
	CreateClientDto,
	CreateDealDto,
	CreateLeadDto,
	CreateFunnelDto,
	CreateStageDto,
	CreateTaskDto,
	MoveTaskDto,
	ReminderInputDto,
	UpdateClientDto,
	UpdateFunnelDto,
	UpdateDealDto,
	UpdateLeadDto,
	UpdateStageDto,
	UpdateTaskDto,
	QualifyLeadDto,
	TariffDto,
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

	/**
	 * Удаление — необратимо, поэтому сотруднику разрешаем сносить только своё.
	 * Админ удаляет что угодно. Записи без автора (createdById = null, старые данные)
	 * считаем «общими» и доверяем только админу.
	 */
	private assertCanDelete(user: CrmUser, createdById: string | null, what: string) {
		if (user.role === 'ADMIN') return
		if (createdById && createdById === user.id) return
		throw new ForbiddenException(`Можно удалять только ${what}, которого завели вы`)
	}

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
	// Отдаём профиль CRM + роли платформы: от них зависит, какие разделы видит сотрудник.
	// Несколько ролей = несколько разделов в одной оболочке.
	async me(user: CrmUser) {
		let platformRoles: string[] = []
		if (user.userId) {
			const account = await this.prisma.user.findUnique({
				where: { id: user.userId },
				select: { role: true, roles: true },
			})
			platformRoles = rolesOf(account)
		}
		return { ...user, platformRoles }
	}

	/**
	 * Воронка дожима триалов: карточка → написали → ответ. Отдаёт и сводку,
	 * и последние касания, чтобы видеть, кто завис без исхода.
	 */
	async trialStats() {
		const [byStatus, recent] = await Promise.all([
			this.prisma.trialOutreach.groupBy({
				by: ['status'],
				_count: { _all: true },
			}),
			this.prisma.trialOutreach.findMany({
				orderBy: { createdAt: 'desc' },
				take: 50,
				select: {
					id: true,
					email: true,
					telegram: true,
					websiteUrl: true,
					visits: true,
					keywords: true,
					status: true,
					trialEndsAt: true,
					handledAt: true,
					createdAt: true,
				},
			}),
		])
		const count = (s: string) =>
			byStatus.find(r => r.status === s)?._count._all ?? 0

		const sentToManager = count('SENT_TO_MANAGER')
		const messageSent = count('MESSAGE_SENT')
		const failed = count('FAILED')
		const total = count('QUEUED') + sentToManager + messageSent + failed

		return {
			totals: {
				total,
				pending: sentToManager, // карточка у менеджера, исход не отмечен
				messageSent,
				failed,
				// Доля дошедших до человека среди тех, по кому исход уже известен.
				reachRate: messageSent + failed > 0
					? Math.round((messageSent / (messageSent + failed)) * 100)
					: 0,
			},
			recent,
		}
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
		// Сотрудник удаляет только то, что завёл сам. Иначе обиженный при увольнении
		// за минуту вычищает карточки коллег — журнал зафиксирует, но данные не вернуть.
		this.assertCanDelete(user, existing.createdById, 'клиента')
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
		this.assertCanDelete(user, existing.createdById, 'задачу')
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

	// ─── Лиды ───────────────────────────────────────────────────────────────────
	// Входящие заявки ДО превращения в клиента. Раньше заявки с сайта уходили только
	// в личку владельцу и нигде не сохранялись.

	async listLeads(query: { status?: string; mine?: boolean; userId?: string }) {
		const where: Prisma.CrmLeadWhereInput = {}
		if (query.status) where.status = query.status as any
		if (query.mine && query.userId) where.assigneeId = query.userId
		return this.prisma.crmLead.findMany({
			where,
			include: { assignee: { select: { id: true, firstName: true, username: true } } },
			orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
			take: 300,
		})
	}

	async createLead(user: CrmUser, dto: CreateLeadDto) {
		const lead = await this.prisma.crmLead.create({
			data: {
				title: dto.title.trim(),
				contact: dto.contact,
				source: dto.source ?? 'MANUAL',
				comment: dto.comment,
				assigneeId: dto.assigneeId || null,
				createdById: user.id,
			},
		})
		this.logActivity(user.id, 'lead.create', 'lead', lead.id, `Создан лид «${lead.title}»`)
		return lead
	}

	async updateLead(user: CrmUser, id: string, dto: UpdateLeadDto) {
		const existing = await this.prisma.crmLead.findUnique({ where: { id } })
		if (!existing) throw new NotFoundException('Лид не найден')
		const data: Prisma.CrmLeadUpdateInput = {}
		if (dto.title !== undefined) data.title = dto.title.trim()
		if (dto.contact !== undefined) data.contact = dto.contact
		if (dto.status !== undefined) data.status = dto.status
		if (dto.comment !== undefined) data.comment = dto.comment
		if (dto.rejectReason !== undefined) data.rejectReason = dto.rejectReason
		if (dto.assigneeId !== undefined) {
			data.assignee = dto.assigneeId ? { connect: { id: dto.assigneeId } } : { disconnect: true }
		}
		const lead = await this.prisma.crmLead.update({ where: { id }, data })
		this.logActivity(user.id, 'lead.update', 'lead', id, `Изменён лид «${lead.title}»`)
		return lead
	}

	/**
	 * Квалификация: лид превращается в клиента, и — если указана сумма — сразу в сделку.
	 * Всё в одной транзакции: иначе при сбое остался бы клиент без сделки или наоборот.
	 */
	async qualifyLead(user: CrmUser, id: string, dto: QualifyLeadDto) {
		const lead = await this.prisma.crmLead.findUnique({ where: { id } })
		if (!lead) throw new NotFoundException('Лид не найден')
		if (lead.status === 'QUALIFIED') throw new BadRequestException('Лид уже квалифицирован')

		const result = await this.prisma.$transaction(async tx => {
			const client = await tx.crmClient.create({
				data: {
					title: lead.title,
					notes: lead.comment,
					assigneeId: lead.assigneeId ?? user.id,
					createdById: user.id,
					status: 'LEAD',
					// Контакт лида — одним полем, раскладываем по типу.
					...(lead.contact?.includes('@') && lead.contact.includes('.')
						? { email: lead.contact }
						: lead.contact?.startsWith('@')
							? { telegram: lead.contact }
							: { phone: lead.contact ?? undefined }),
				},
			})

			let deal: any = null
			if (dto.amount != null || dto.stageId) {
				const stage = dto.stageId
					? await tx.crmFunnelStage.findUnique({ where: { id: dto.stageId } })
					: null
				deal = await tx.crmDeal.create({
					data: {
						clientId: client.id,
						title: lead.title,
						amount: dto.amount ?? 0,
						tariffId: dto.tariffId || null,
						stageId: stage?.id ?? null,
						funnelId: stage?.funnelId ?? null,
						assigneeId: lead.assigneeId ?? user.id,
						createdById: user.id,
					},
				})
			}

			await tx.crmLead.update({
				where: { id },
				data: { status: 'QUALIFIED', clientId: client.id },
			})
			return { client, deal }
		})

		this.logActivity(user.id, 'lead.qualify', 'lead', id, `Лид «${lead.title}» стал клиентом`)
		return result
	}

	async deleteLead(user: CrmUser, id: string) {
		const existing = await this.prisma.crmLead.findUnique({ where: { id } })
		if (!existing) throw new NotFoundException('Лид не найден')
		this.assertCanDelete(user, existing.createdById, 'лид')
		await this.prisma.crmLead.delete({ where: { id } })
		this.logActivity(user.id, 'lead.delete', 'lead', id, `Удалён лид «${existing.title}»`, true)
		return { ok: true }
	}

	// ─── Сделки ─────────────────────────────────────────────────────────────────

	async listDeals(query: { status?: string; clientId?: string; mine?: boolean; userId?: string }) {
		const where: Prisma.CrmDealWhereInput = {}
		if (query.status) where.status = query.status as any
		if (query.clientId) where.clientId = query.clientId
		if (query.mine && query.userId) where.assigneeId = query.userId
		return this.prisma.crmDeal.findMany({
			where,
			include: {
				client: { select: { id: true, title: true } },
				assignee: { select: { id: true, firstName: true, username: true } },
				tariff: { select: { id: true, name: true } },
			},
			orderBy: [{ position: 'asc' }, { createdAt: 'desc' }],
			take: 500,
		})
	}

	/** Доска сделок по воронке: колонки-этапы + СУММА в шапке каждой колонки. */
	async dealBoard(funnelId: string) {
		const funnel = await this.prisma.crmFunnel.findUnique({
			where: { id: funnelId },
			include: { stages: { orderBy: { position: 'asc' } } },
		})
		if (!funnel) throw new NotFoundException('Воронка не найдена')

		const deals = await this.prisma.crmDeal.findMany({
			where: { funnelId, status: 'OPEN' },
			include: {
				client: { select: { id: true, title: true } },
				assignee: { select: { id: true, firstName: true, username: true } },
			},
			orderBy: [{ position: 'asc' }, { createdAt: 'desc' }],
		})

		const stages = funnel.stages.map(stage => {
			const own = deals.filter(d => d.stageId === stage.id)
			return {
				...stage,
				deals: own,
				total: own.reduce((sum, d) => sum + d.amount, 0),
			}
		})
		return { ...funnel, stages, total: deals.reduce((s, d) => s + d.amount, 0) }
	}

	async createDeal(user: CrmUser, dto: CreateDealDto) {
		const stage = dto.stageId
			? await this.prisma.crmFunnelStage.findUnique({ where: { id: dto.stageId } })
			: null
		const deal = await this.prisma.crmDeal.create({
			data: {
				clientId: dto.clientId,
				title: dto.title.trim(),
				amount: dto.amount ?? 0,
				tariffId: dto.tariffId || null,
				stageId: stage?.id ?? null,
				funnelId: stage?.funnelId ?? null,
				probability: dto.probability ?? 50,
				expectedCloseAt: dto.expectedCloseAt ? new Date(dto.expectedCloseAt) : null,
				assigneeId: dto.assigneeId || user.id,
				createdById: user.id,
			},
		})
		this.logActivity(user.id, 'deal.create', 'deal', deal.id, `Создана сделка «${deal.title}» на ${deal.amount} ₽`)
		return deal
	}

	async updateDeal(user: CrmUser, id: string, dto: UpdateDealDto) {
		const existing = await this.prisma.crmDeal.findUnique({ where: { id } })
		if (!existing) throw new NotFoundException('Сделка не найдена')
		const data: Prisma.CrmDealUpdateInput = {}
		if (dto.title !== undefined) data.title = dto.title.trim()
		if (dto.amount !== undefined) data.amount = dto.amount
		if (dto.status !== undefined) data.status = dto.status
		if (dto.lostReason !== undefined) data.lostReason = dto.lostReason
		if (dto.probability !== undefined) data.probability = dto.probability
		if (dto.expectedCloseAt !== undefined) {
			data.expectedCloseAt = dto.expectedCloseAt ? new Date(dto.expectedCloseAt) : null
		}
		if (dto.tariffId !== undefined) {
			data.tariff = dto.tariffId ? { connect: { id: dto.tariffId } } : { disconnect: true }
		}
		if (dto.assigneeId !== undefined) {
			data.assignee = dto.assigneeId ? { connect: { id: dto.assigneeId } } : { disconnect: true }
		}
		const deal = await this.prisma.crmDeal.update({ where: { id }, data })
		const changedMoney = dto.amount !== undefined && dto.amount !== existing.amount
		this.logActivity(
			user.id,
			'deal.update',
			'deal',
			id,
			changedMoney
				? `Сумма сделки «${deal.title}»: ${existing.amount} → ${deal.amount} ₽`
				: `Изменена сделка «${deal.title}»`,
			existing.createdById != null && existing.createdById !== user.id,
		)
		return deal
	}

	async moveDeal(user: CrmUser, id: string, stageId: string) {
		const stage = await this.prisma.crmFunnelStage.findUnique({ where: { id: stageId } })
		if (!stage) throw new NotFoundException('Этап не найден')
		const deal = await this.prisma.crmDeal.update({
			where: { id },
			data: { stageId: stage.id, funnelId: stage.funnelId },
		})
		this.logActivity(user.id, 'deal.move', 'deal', id, `Сделка «${deal.title}» → «${stage.title}»`)
		return deal
	}

	async deleteDeal(user: CrmUser, id: string) {
		const existing = await this.prisma.crmDeal.findUnique({ where: { id } })
		if (!existing) throw new NotFoundException('Сделка не найдена')
		this.assertCanDelete(user, existing.createdById, 'сделку')
		await this.prisma.crmDeal.delete({ where: { id } })
		this.logActivity(user.id, 'deal.delete', 'deal', id, `Удалена сделка «${existing.title}» на ${existing.amount} ₽`, true)
		return { ok: true }
	}

	// ─── Тарифы ─────────────────────────────────────────────────────────────────

	async listTariffs(onlyActive = false) {
		return this.prisma.tariff.findMany({
			where: onlyActive ? { isActive: true } : {},
			orderBy: [{ position: 'asc' }, { price: 'asc' }],
		})
	}

	async createTariff(user: CrmUser, dto: TariffDto) {
		const last = await this.prisma.tariff.findFirst({ orderBy: { position: 'desc' } })
		const tariff = await this.prisma.tariff.create({
			data: {
				name: (dto.name || 'Без названия').trim(),
				description: dto.description,
				points: dto.points ?? 0,
				price: dto.price ?? 0,
				position: (last?.position ?? 0) + 1,
			},
		})
		this.logActivity(user.id, 'tariff.create', 'tariff', tariff.id, `Создан тариф «${tariff.name}»`)
		return tariff
	}

	async updateTariff(user: CrmUser, id: string, dto: TariffDto) {
		const data: Prisma.TariffUpdateInput = {}
		if (dto.name !== undefined) data.name = dto.name.trim()
		if (dto.description !== undefined) data.description = dto.description
		if (dto.points !== undefined) data.points = dto.points
		if (dto.price !== undefined) data.price = dto.price
		if (dto.isActive !== undefined) data.isActive = !!dto.isActive
		const tariff = await this.prisma.tariff.update({ where: { id }, data })
		this.logActivity(user.id, 'tariff.update', 'tariff', id, `Изменён тариф «${tariff.name}»`)
		return tariff
	}

	async deleteTariff(user: CrmUser, id: string) {
		const existing = await this.prisma.tariff.findUnique({ where: { id } })
		if (!existing) throw new NotFoundException('Тариф не найден')
		// Не удаляем, если на тариф уже ссылаются сделки — иначе потеряем историю продаж.
		const used = await this.prisma.crmDeal.count({ where: { tariffId: id } })
		if (used > 0) {
			await this.prisma.tariff.update({ where: { id }, data: { isActive: false } })
			this.logActivity(user.id, 'tariff.archive', 'tariff', id, `Тариф «${existing.name}» выключен (используется в ${used} сделках)`)
			return { ok: true, archived: true }
		}
		await this.prisma.tariff.delete({ where: { id } })
		this.logActivity(user.id, 'tariff.delete', 'tariff', id, `Удалён тариф «${existing.name}»`)
		return { ok: true, archived: false }
	}


	// ─── Клиенты платформы (переехало из кабинета менеджера) ────────────────────
	// Кабинет /manager удалён — его работа живёт здесь. Опасные операции
	// (проведение платежей, удаление сайтов и ключей) намеренно НЕ переносим:
	// они остаются у владельца в админке, потому что необратимы и касаются денег.

	/** Список клиентов платформы со «здоровьем» — кто отваливается. */
	platformClients() {
		return this.manager.listClients()
	}

	/** Карточка клиента платформы: сайты, ключи, позиции, динамика. */
	platformClient(userId: string) {
		return this.manager.getClient(userId)
	}

	platformClientTrend(userId: string) {
		return this.manager.getClientTrend(userId)
	}

	platformClientLogs(userId: string, limit = 60) {
		return this.manager.getClientLogs(userId, limit)
	}

	/** «Кого дожать» — рабочая очередь менеджера. */
	outreachQueue() {
		return this.manager.getOutreach()
	}

	// Заметки по клиенту платформы — общая история общения.
	platformNotes(userId: string) {
		return this.manager.listNotes(userId)
	}

	async addPlatformNote(user: CrmUser, userId: string, text: string) {
		const note = await this.manager.addNote(userId, user.email ?? 'CRM', text)
		this.logActivity(user.id, 'note.create', 'client', userId, `Заметка по клиенту платформы`)
		return note
	}

}
