import {
	Body,
	Controller,
	Delete,
	Get,
	Param,
	Patch,
	Post,
	Query,
	UseGuards,
} from '@nestjs/common'
import { CrmUser } from '@prisma/client'
import { AdminService } from '../admin/admin.service'
import { CrmAdminGuard } from './crm-admin.guard'
import { CrmAuthGuard } from './crm-auth.guard'
import { CrmManageGuard } from './crm-manage.guard'
import { CrmAuthService } from './crm-auth.service'
import { CrmCurrentUser } from './crm-user.decorator'
import { CrmService } from './crm.service'
import {
	CreateClientDto,
	CreateDealDto,
	CreateLeadDto,
	CreateFunnelDto,
	CreateStageDto,
	CreateTaskDto,
	CrmLoginDto,
	CrmPasswordLoginDto,
	MoveClientStageDto,
	MoveDealDto,
	QualifyLeadDto,
	TariffDto,
	UpdateDealDto,
	UpdateLeadDto,
	MoveStageDto,
	MoveTaskDto,
	ReminderInputDto,
	UpdateClientDto,
	UpdateFunnelDto,
	UpdateStageDto,
	UpdateTaskDto,
} from './dto'

// Публичные эндпоинты входа (без гварда).
@Controller('crm/auth')
export class CrmAuthController {
	constructor(private auth: CrmAuthService) {}

	// ОСНОВНОЙ вход: email + пароль аккаунта платформы. Роль берётся из User.roles.
	@Post('login')
	login(@Body() dto: CrmPasswordLoginDto) {
		return this.auth.loginWithPassword(dto.email, dto.password)
	}

	// Вход с телефона для тех, кто уже привязал Telegram в профиле.
	@Post('telegram')
	telegram(@Body() dto: CrmLoginDto) {
		return this.auth.loginWithInitData(dto.initData)
	}

	// Только вне продакшена (проверяется в сервисе).
	@Post('dev')
	dev() {
		return this.auth.devLogin()
	}

	// Вход с сайта в браузере через Telegram Login Widget. Тело — сырой объект
	// виджета (id, first_name, auth_date, hash…); подпись проверяется в сервисе.
	@Post('widget')
	widget(@Body() body: Record<string, any>) {
		return this.auth.loginWithWidget(body)
	}
}

@Controller('crm')
@UseGuards(CrmAuthGuard)
export class CrmController {
	constructor(
		private crm: CrmService,
		private auth: CrmAuthService,
		private admin: AdminService,
	) {}

	@Get('me')
	me(@CrmCurrentUser() user: CrmUser) {
		return this.crm.me(user)
	}

	// Привязка Telegram к своему профилю: уведомления + быстрый вход с телефона.
	@Post('me/telegram')
	linkTelegram(@CrmCurrentUser() user: CrmUser, @Body() dto: CrmLoginDto) {
		return this.auth.linkTelegram(user.id, dto.initData)
	}

	@Delete('me/telegram')
	unlinkTelegram(@CrmCurrentUser() user: CrmUser) {
		return this.auth.unlinkTelegram(user.id)
	}

	@Get('dashboard')
	dashboard(@CrmCurrentUser() user: CrmUser) {
		return this.crm.dashboard(user)
	}

	// Статистика по дожимам заканчивающихся триалов: сколько карточек ушло
	// менеджерам, по скольким написали, где не смогли.
	@Get('trials')
	trials() {
		return this.crm.trialStats()
	}

	// ─── clients ───
	@Get('clients')
	listClients(
		@CrmCurrentUser() user: CrmUser,
		@Query('q') q?: string,
		@Query('status') status?: string,
		@Query('mine') mine?: string,
	) {
		return this.crm.listClients({ q, status, mine: mine === '1' || mine === 'true', userId: user.id })
	}

	@Post('clients')
	createClient(@CrmCurrentUser() user: CrmUser, @Body() dto: CreateClientDto) {
		return this.crm.createClient(user, dto)
	}

	@Get('clients/:id')
	getClient(@Param('id') id: string) {
		return this.crm.getClient(id)
	}

	@Patch('clients/:id')
	updateClient(
		@CrmCurrentUser() user: CrmUser,
		@Param('id') id: string,
		@Body() dto: UpdateClientDto,
	) {
		return this.crm.updateClient(user, id, dto)
	}

	@Delete('clients/:id')
	deleteClient(@CrmCurrentUser() user: CrmUser, @Param('id') id: string) {
		return this.crm.deleteClient(user, id)
	}

	@Get('clients/:id/positions')
	clientPositions(@Param('id') id: string) {
		return this.crm.getClientPositions(id)
	}

	@Get('accounts/search')
	searchAccounts(@Query('q') q: string) {
		return this.crm.searchAccounts(q)
	}

	// ─── tasks ───
	@Get('tasks')
	listTasks(
		@CrmCurrentUser() user: CrmUser,
		@Query('status') status?: string,
		@Query('clientId') clientId?: string,
		@Query('assigneeId') assigneeId?: string,
		@Query('mine') mine?: string,
	) {
		return this.crm.listTasks({
			status,
			clientId,
			assigneeId,
			mine: mine === '1' || mine === 'true',
			userId: user.id,
		})
	}

	@Post('tasks')
	createTask(@CrmCurrentUser() user: CrmUser, @Body() dto: CreateTaskDto) {
		return this.crm.createTask(user, dto)
	}

	@Get('tasks/:id')
	getTask(@Param('id') id: string) {
		return this.crm.getTask(id)
	}

	@Patch('tasks/:id')
	updateTask(
		@CrmCurrentUser() user: CrmUser,
		@Param('id') id: string,
		@Body() dto: UpdateTaskDto,
	) {
		return this.crm.updateTask(user, id, dto)
	}

	@Post('tasks/:id/move')
	moveTask(
		@CrmCurrentUser() user: CrmUser,
		@Param('id') id: string,
		@Body() dto: MoveTaskDto,
	) {
		return this.crm.moveTask(user, id, dto)
	}

	@Delete('tasks/:id')
	deleteTask(@CrmCurrentUser() user: CrmUser, @Param('id') id: string) {
		return this.crm.deleteTask(user, id)
	}

	@Post('tasks/:id/reminders')
	addReminder(
		@CrmCurrentUser() user: CrmUser,
		@Param('id') id: string,
		@Body() dto: ReminderInputDto,
	) {
		return this.crm.addReminder(user, id, dto)
	}

	@Delete('reminders/:id')
	deleteReminder(@CrmCurrentUser() user: CrmUser, @Param('id') id: string) {
		return this.crm.deleteReminder(user, id)
	}

	// ─── funnels (пайплайны) ───
	@Get('funnels')
	listFunnels() {
		return this.crm.listFunnels()
	}

	@Post('funnels')
	@UseGuards(CrmManageGuard)
	createFunnel(@CrmCurrentUser() user: CrmUser, @Body() dto: CreateFunnelDto) {
		return this.crm.createFunnel(user, dto)
	}

	@Get('funnels/:id/board')
	funnelBoard(@Param('id') id: string) {
		return this.crm.funnelBoard(id)
	}

	@Patch('funnels/:id')
	@UseGuards(CrmManageGuard)
	updateFunnel(@CrmCurrentUser() user: CrmUser, @Param('id') id: string, @Body() dto: UpdateFunnelDto) {
		return this.crm.updateFunnel(user, id, dto)
	}

	@Delete('funnels/:id')
	@UseGuards(CrmManageGuard)
	deleteFunnel(@CrmCurrentUser() user: CrmUser, @Param('id') id: string) {
		return this.crm.deleteFunnel(user, id)
	}

	@Post('funnels/:id/stages')
	@UseGuards(CrmManageGuard)
	addStage(@CrmCurrentUser() user: CrmUser, @Param('id') id: string, @Body() dto: CreateStageDto) {
		return this.crm.addStage(user, id, dto)
	}

	@Patch('stages/:id')
	@UseGuards(CrmManageGuard)
	updateStage(@CrmCurrentUser() user: CrmUser, @Param('id') id: string, @Body() dto: UpdateStageDto) {
		return this.crm.updateStage(user, id, dto)
	}

	@Post('stages/:id/move')
	@UseGuards(CrmManageGuard)
	moveStage(@CrmCurrentUser() user: CrmUser, @Param('id') id: string, @Body() dto: MoveStageDto) {
		return this.crm.moveStage(user, id, dto.position)
	}

	@Delete('stages/:id')
	@UseGuards(CrmManageGuard)
	deleteStage(@CrmCurrentUser() user: CrmUser, @Param('id') id: string) {
		return this.crm.deleteStage(user, id)
	}

	@Post('clients/:id/stage')
	moveClientStage(@CrmCurrentUser() user: CrmUser, @Param('id') id: string, @Body() dto: MoveClientStageDto) {
		return this.crm.moveClientStage(user, id, dto.stageId)
	}

	// ─── Лиды ───
	@Get('leads')
	listLeads(@CrmCurrentUser() user: CrmUser, @Query('status') status?: string, @Query('mine') mine?: string) {
		return this.crm.listLeads({ status, mine: mine === '1' || mine === 'true', userId: user.id })
	}

	@Post('leads')
	createLead(@CrmCurrentUser() user: CrmUser, @Body() dto: CreateLeadDto) {
		return this.crm.createLead(user, dto)
	}

	@Patch('leads/:id')
	updateLead(@CrmCurrentUser() user: CrmUser, @Param('id') id: string, @Body() dto: UpdateLeadDto) {
		return this.crm.updateLead(user, id, dto)
	}

	// Лид → клиент (+ сделка, если указана сумма)
	@Post('leads/:id/qualify')
	qualifyLead(@CrmCurrentUser() user: CrmUser, @Param('id') id: string, @Body() dto: QualifyLeadDto) {
		return this.crm.qualifyLead(user, id, dto)
	}

	@Delete('leads/:id')
	deleteLead(@CrmCurrentUser() user: CrmUser, @Param('id') id: string) {
		return this.crm.deleteLead(user, id)
	}

	// ─── Сделки ───
	@Get('deals')
	listDeals(
		@CrmCurrentUser() user: CrmUser,
		@Query('status') status?: string,
		@Query('clientId') clientId?: string,
		@Query('mine') mine?: string,
	) {
		return this.crm.listDeals({ status, clientId, mine: mine === '1' || mine === 'true', userId: user.id })
	}

	// Доска сделок: колонки-этапы с суммой в шапке
	@Get('funnels/:id/deals')
	dealBoard(@Param('id') id: string) {
		return this.crm.dealBoard(id)
	}

	@Post('deals')
	createDeal(@CrmCurrentUser() user: CrmUser, @Body() dto: CreateDealDto) {
		return this.crm.createDeal(user, dto)
	}

	@Patch('deals/:id')
	updateDeal(@CrmCurrentUser() user: CrmUser, @Param('id') id: string, @Body() dto: UpdateDealDto) {
		return this.crm.updateDeal(user, id, dto)
	}

	@Post('deals/:id/move')
	moveDeal(@CrmCurrentUser() user: CrmUser, @Param('id') id: string, @Body() dto: MoveDealDto) {
		return this.crm.moveDeal(user, id, dto.stageId)
	}

	@Delete('deals/:id')
	deleteDeal(@CrmCurrentUser() user: CrmUser, @Param('id') id: string) {
		return this.crm.deleteDeal(user, id)
	}

	// ─── Тарифы (правит только админ) ───
	@Get('tariffs')
	listTariffs(@Query('active') active?: string) {
		return this.crm.listTariffs(active === '1' || active === 'true')
	}

	@Post('tariffs')
	@UseGuards(CrmAdminGuard)
	createTariff(@CrmCurrentUser() user: CrmUser, @Body() dto: TariffDto) {
		return this.crm.createTariff(user, dto)
	}

	@Patch('tariffs/:id')
	@UseGuards(CrmAdminGuard)
	updateTariff(@CrmCurrentUser() user: CrmUser, @Param('id') id: string, @Body() dto: TariffDto) {
		return this.crm.updateTariff(user, id, dto)
	}

	@Delete('tariffs/:id')
	@UseGuards(CrmAdminGuard)
	deleteTariff(@CrmCurrentUser() user: CrmUser, @Param('id') id: string) {
		return this.crm.deleteTariff(user, id)
	}

	// ─── Клиенты платформы (переехало из кабинета /manager) ───
	@Get('platform-clients')
	platformClients() {
		return this.crm.platformClients()
	}

	@Get('platform-clients/:id')
	platformClient(@Param('id') id: string) {
		return this.crm.platformClient(id)
	}

	@Get('platform-clients/:id/trend')
	platformClientTrend(@Param('id') id: string) {
		return this.crm.platformClientTrend(id)
	}

	@Get('platform-clients/:id/logs')
	platformClientLogs(@Param('id') id: string, @Query('limit') limit?: string) {
		return this.crm.platformClientLogs(id, limit ? Number(limit) : 60)
	}

	@Get('platform-clients/:id/notes')
	platformNotes(@Param('id') id: string) {
		return this.crm.platformNotes(id)
	}

	@Post('platform-clients/:id/notes')
	addPlatformNote(@CrmCurrentUser() user: CrmUser, @Param('id') id: string, @Body() body: { text: string }) {
		return this.crm.addPlatformNote(user, id, body?.text ?? '')
	}

	// «Кого дожать» — рабочая очередь
	@Get('outreach-queue')
	outreachQueue() {
		return this.crm.outreachQueue()
	}

	// ─── calendar ───
	@Get('calendar')
	calendar(@Query('from') from: string, @Query('to') to: string) {
		return this.crm.calendar(from, to)
	}

	// Лёгкий список участников (для выпадашек «ответственный»).
	@Get('members')
	membersLite() {
		return this.crm.membersLite()
	}

	// ─── team / activity (только админ CRM) ───
	// ─── сотрудники: роли и доступ (только админ CRM) ───
	// Заменяет «нанять = SQL на проде»: роли выдаются галочками, TG-id можно вписать сразу.

	@Get('team/staff')
	@UseGuards(CrmAdminGuard)
	listStaff() {
		return this.admin.listStaff()
	}

	@Post('team/staff')
	@UseGuards(CrmAdminGuard)
	createStaff(
		@CrmCurrentUser() user: CrmUser,
		@Body() body: { email: string; roles: string[]; telegramId?: string },
	) {
		return this.admin.createStaff(body, user.email ?? undefined)
	}

	@Patch('team/staff/:id/roles')
	@UseGuards(CrmAdminGuard)
	setStaffRoles(
		@CrmCurrentUser() user: CrmUser,
		@Param('id') id: string,
		@Body() body: { roles: string[] },
	) {
		return this.admin.setStaffRoles(id, body?.roles ?? [], user.email ?? undefined)
	}

	@Patch('team/staff/:id/telegram')
	@UseGuards(CrmAdminGuard)
	setStaffTelegram(
		@CrmCurrentUser() user: CrmUser,
		@Param('id') id: string,
		@Body() body: { telegramId?: string | null },
	) {
		return this.admin.setStaffTelegram(id, body?.telegramId ?? null, user.email ?? undefined)
	}

	@Get('team/members')
	@UseGuards(CrmAdminGuard)
	members() {
		return this.crm.members()
	}

	@Get('team/activity')
	@UseGuards(CrmAdminGuard)
	activity(@Query('limit') limit?: string, @Query('suspicious') suspicious?: string) {
		return this.crm.activity({
			limit: limit ? Number(limit) : undefined,
			suspicious: suspicious === '1' || suspicious === 'true',
		})
	}
}
