import {
	Body,
	Controller,
	Delete,
	Get,
	Param,
	Post,
	Put,
	Query,
	Request,
	UseGuards,
} from '@nestjs/common'
import { SkipThrottle, Throttle } from '@nestjs/throttler'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { CreateTaskDto, UpdateTaskDto } from './dto'
import { TasksService } from './tasks.service'

@SkipThrottle({ short: true, medium: true })
@Controller('tasks')
@UseGuards(JwtAuthGuard)
export class TasksController {
	constructor(private tasksService: TasksService) {}

	@Post()
	async create(@Request() req, @Body() dto: CreateTaskDto) {
		// Триальный лимит на ключи применяем только к веб-версии; приложение не трогаем
		const isApp = String(req.headers?.['user-agent'] || '').includes('SkySEO-Desktop')
		return this.tasksService.create(req.user.id, dto, isApp)
	}

	@Get('my')
	async getUserTasks(@Request() req, @Query('websiteId') websiteId?: string) {
		return this.tasksService.getUserTasks(req.user.id, websiteId)
	}

	@Throttle({ short: { limit: 60, ttl: 60000 } })
	@Get('available-queue')
	async getAvailableTasks(@Request() req, @Query('limit') limit?: string) {
		const limitNum = limit ? parseInt(limit, 10) : 10
		return this.tasksService.getAvailableTasks(req.user.id, limitNum)
	}

	// Тяжёлая диагностика (несколько агрегаций) — ограничиваем 10/мин, перебивая
	// классовый @SkipThrottle, чтобы её нельзя было заспамить.
	@Throttle({ short: { limit: 10, ttl: 60000 } })
	@Get('available-queue/debug')
	async debugAvailability(@Request() req) {
		return this.tasksService.debugAvailability(req.user.id)
	}

	@Post(':id/assign')
	async assignTask(@Request() req, @Param('id') taskId: string) {
		return this.tasksService.assignTask(taskId, req.user.id)
	}

	@Post(':id/report-restricted')
	async reportRestricted(@Request() req, @Param('id') taskId: string, @Body() body: { message?: string; telegram?: string }) {
		return this.tasksService.reportRestrictedKeyword(req.user.id, taskId, body?.message ?? '', body?.telegram ?? '')
	}

	@Get(':id/position-history')
	async getPositionHistory(
		@Param('id') taskId: string,
		@Query('days') days?: string,
	) {
		const daysNum = days ? parseInt(days, 10) : 7
		return this.tasksService.getPositionHistory(taskId, daysNum)
	}

	@Post(':id/initial-position')
	async saveInitialPosition(
		@Param('id') taskId: string,
		@Body()
		body: { yandexPosition: number | null; googlePosition?: number | null },
	) {
		return this.tasksService.saveInitialPosition(
			taskId,
			body.yandexPosition,
			body.googlePosition ?? null,
		)
	}

	@Throttle({ short: { limit: 3, ttl: 60000 } })
	@Post('request-help')
	async requestHelp(@Request() req) {
		return this.tasksService.sendHelpRequest(req.user.id)
	}

	@Put(':id')
	async updateTask(@Request() req, @Param('id') taskId: string, @Body() dto: UpdateTaskDto) {
		return this.tasksService.updateTask(req.user.id, taskId, dto)
	}

	@Delete(':id')
	async deleteTask(@Request() req, @Param('id') taskId: string) {
		return this.tasksService.deleteTask(req.user.id, taskId)
	}
}
