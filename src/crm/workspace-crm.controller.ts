import {
	Body, Controller, ForbiddenException, Get, NotFoundException,
	Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common'
import { CrmUser, User } from '@prisma/client'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { CurrentUser } from '../common/decorators/user.decorator'
import { hasRoleStrict } from '../common/roles'
import { PrismaService } from '../prisma/prisma.service'
import { SprintGuard } from '../sprint/sprint.guard'
import { CrmService } from './crm.service'
import { FollowUpService } from './follow-up.service'
import {
	CreateFunnelDto, CreateStageDto, CreateTaskDto, MoveLeadStageDto,
	QualifyLeadDto, SaveFollowUpDto, UpdateDealDto, UpdateLeadDto,
} from './dto'

/** Sales CRM inside the existing workspace, authenticated by the platform JWT. */
@Controller('workspace/crm')
@UseGuards(JwtAuthGuard, SprintGuard)
export class WorkspaceCrmController {
	constructor(
		private readonly prisma: PrismaService,
		private readonly crm: CrmService,
		private readonly followUp: FollowUpService,
	) {}

	private actor(user: User): Promise<CrmUser> {
		const role = hasRoleStrict(user, 'ADMIN') ? 'ADMIN' : 'EMPLOYEE'
		return this.prisma.crmUser.upsert({
			where: { userId: user.id },
			create: { userId: user.id, email: user.email, role, lastSeenAt: new Date() },
			update: { email: user.email, role, isActive: true, lastSeenAt: new Date() },
		})
	}

	private async editable(user: User, leadId: string) {
		const actor = await this.actor(user)
		const lead = await this.prisma.crmLead.findUnique({ where: { id: leadId }, select: { assigneeId: true, createdById: true } })
		if (!lead) throw new NotFoundException('Лид не найден')
		if (actor.role !== 'ADMIN' && lead.assigneeId && lead.assigneeId !== actor.id)
			throw new ForbiddenException('Лид закреплён за другим сотрудником')
		return actor
	}

	private async viewable(user: User, leadId: string) {
		return this.editable(user, leadId)
	}

	@Get('me')
	me(@CurrentUser() user: User) { return this.actor(user) }

	@Get('funnels')
	funnels() { return this.crm.listFunnels() }

	@Post('funnels')
	async createFunnel(@CurrentUser() user: User, @Body() dto: CreateFunnelDto) {
		const actor = await this.actor(user)
		if (actor.role !== 'ADMIN') throw new ForbiddenException('Воронки настраивает администратор')
		return this.crm.createFunnel(actor, dto)
	}

	@Post('funnels/:id/stages')
	async addStage(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: CreateStageDto) {
		const actor = await this.actor(user)
		if (actor.role !== 'ADMIN') throw new ForbiddenException('Этапы настраивает администратор')
		return this.crm.addStage(actor, id, dto)
	}

	@Get('funnels/:id/board')
	async board(@CurrentUser() user: User, @Param('id') id: string) { return this.crm.leadBoard(id, await this.actor(user)) }

	@Get('leads')
	async leads(
		@CurrentUser() user: User,
		@Query('q') q?: string, @Query('status') status?: string,
		@Query('funnelId') funnelId?: string, @Query('stageId') stageId?: string,
		@Query('page') page?: string, @Query('limit') limit?: string,
	) {
		return this.crm.leadPage({ q, status, funnelId, stageId, page: Number(page) || 1, limit: Number(limit) || 30 }, await this.actor(user))
	}

	@Get('leads/:id')
	async lead(@CurrentUser() user: User, @Param('id') id: string) {
		await this.viewable(user, id)
		return this.crm.getLead(id)
	}

	@Post('recipients/:id/lead')
	async fromRecipient(@CurrentUser() user: User, @Param('id') id: string) {
		const lead = await this.crm.ensureLeadFromRecipient(await this.actor(user), id)
		await this.viewable(user, lead.id)
		return lead
	}

	@Get('recipients/:id/context')
	async recipientContext(@CurrentUser() user: User, @Param('id') id: string) {
		const actor = await this.actor(user)
		const recipient = await this.prisma.tgRecipient.findUnique({
			where: { id },
			select: {
				id: true, leadId: true, crmLeadId: true, domain: true, company: true,
				firstName: true, middleName: true, lastName: true, username: true, phone: true,
				outcome: true, campaignId: true, hypothesisId: true,
				followUpTask: { select: { id: true, kind: true, title: true, dueAt: true, description: true, status: true, followUpRecipientId: true } },
				crmLead: { select: {
					id: true, title: true, status: true, funnelId: true, stageId: true, assigneeId: true, budgetMin: true,
					budgetMax: true, budgetComment: true, decisionMaker: true, comment: true,
					stage: { select: { title: true } },
					deals: { orderBy: { createdAt: 'desc' }, take: 1, select: { id: true, title: true, amount: true, status: true, lostReason: true } },
					tasks: { where: { status: { not: 'DONE' } }, orderBy: { dueAt: 'asc' }, take: 5,
						select: { id: true, kind: true, title: true, dueAt: true, description: true, followUpRecipientId: true } },
				} },
			},
		})
		if (!recipient) throw new NotFoundException('Диалог не найден')
		if (actor.role !== 'ADMIN' && recipient.crmLead?.assigneeId && recipient.crmLead.assigneeId !== actor.id)
			return { ...recipient, crmLead: null, crmLocked: true }
		return recipient
	}

	@Patch('leads/:id')
	async updateLead(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: UpdateLeadDto) {
		return this.crm.updateLead(await this.editable(user, id), id, dto)
	}

	@Post('leads/:id/stage')
	async moveLead(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: MoveLeadStageDto) {
		return this.crm.moveLeadStage(await this.editable(user, id), id, dto.stageId)
	}

	@Post('leads/:id/follow-up')
	async saveFollowUp(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: SaveFollowUpDto) {
		const actor = await this.editable(user, id)
		return this.followUp.saveCrm({
			leadId: id, actorId: actor.id, taskId: dto.taskId, recipientId: dto.recipientId,
			dueAt: dto.dueAt ? new Date(dto.dueAt) : null, note: dto.note,
		})
	}

	@Post('leads/:id/calls')
	async scheduleCall(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: CreateTaskDto) {
		const actor = await this.editable(user, id)
		return this.crm.scheduleCall(actor, id, dto)
	}

	@Post('tasks/:id/complete')
	async completeTask(@CurrentUser() user: User, @Param('id') id: string) {
		const actor = await this.actor(user)
		const task = await this.prisma.crmTask.findUnique({ where: { id }, select: {
			id: true, kind: true, leadId: true, assigneeId: true, followUpRecipientId: true,
		} })
		if (!task) throw new NotFoundException('Задача не найдена')
		if (task.leadId) await this.editable(user, task.leadId)
		else if (actor.role !== 'ADMIN' && task.assigneeId && task.assigneeId !== actor.id)
			throw new ForbiddenException('Задача закреплена за другим сотрудником')
		if (task.kind === 'FOLLOW_UP') {
			if (task.followUpRecipientId)
				return this.followUp.saveRecipient({ recipientId: task.followUpRecipientId, dueAt: null, actorId: actor.id })
			if (!task.leadId) throw new NotFoundException('CRM-лид для follow-up не найден')
			return this.followUp.saveCrm({ leadId: task.leadId, taskId: task.id, dueAt: null, actorId: actor.id })
		}
		return this.crm.updateTask(actor, id, { status: 'DONE' })
	}

	@Post('leads/:id/qualify')
	async qualify(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: QualifyLeadDto) {
		return this.crm.qualifyLead(await this.editable(user, id), id, dto)
	}

	@Get('today')
	async today(@CurrentUser() user: User) { return this.crm.today(await this.actor(user)) }

	@Get('analytics')
	async analytics(@CurrentUser() user: User) {
		if ((await this.actor(user)).role !== 'ADMIN') throw new ForbiddenException('Аналитика доступна администратору')
		return this.crm.salesAnalytics()
	}

	@Get('deals')
	async deals(@CurrentUser() user: User, @Query('status') status?: string) {
		const actor = await this.actor(user)
		return this.crm.listDeals({ status, mine: actor.role !== 'ADMIN', userId: actor.id })
	}

	@Patch('deals/:id')
	async updateDeal(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: UpdateDealDto) {
		const actor = await this.actor(user)
		const deal = await this.prisma.crmDeal.findUnique({ where: { id }, select: { assigneeId: true, createdById: true } })
		if (!deal) throw new NotFoundException('Сделка не найдена')
		if (actor.role !== 'ADMIN' && deal.assigneeId && deal.assigneeId !== actor.id)
			throw new ForbiddenException('Сделка закреплена за другим сотрудником')
		return this.crm.updateDeal(actor, id, dto)
	}
}
