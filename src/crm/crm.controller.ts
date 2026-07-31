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
import { CrmAdminGuard } from './crm-admin.guard'
import { CrmAuthGuard } from './crm-auth.guard'
import { CrmManageGuard } from './crm-manage.guard'
import { CrmAuthService } from './crm-auth.service'
import { CrmCurrentUser } from './crm-user.decorator'
import { CrmService } from './crm.service'
import {
	CreateClientDto,
	CreateFunnelDto,
	CreateStageDto,
	CreateTaskDto,
	CrmLoginDto,
	MoveClientStageDto,
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
	constructor(private crm: CrmService) {}

	@Get('me')
	me(@CrmCurrentUser() user: CrmUser) {
		return this.crm.me(user)
	}

	@Get('dashboard')
	dashboard(@CrmCurrentUser() user: CrmUser) {
		return this.crm.dashboard(user)
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
