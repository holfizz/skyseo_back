import {
	Body,
	Controller,
	Delete,
	Get,
	Param,
	Post,
	Query,
	Request,
	UseGuards,
} from '@nestjs/common'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { CreateTaskDto } from './dto'
import { TasksService } from './tasks.service'

@Controller('tasks')
@UseGuards(JwtAuthGuard)
export class TasksController {
	constructor(private tasksService: TasksService) {}

	@Post()
	async create(@Request() req, @Body() dto: CreateTaskDto) {
		return this.tasksService.create(req.user.id, dto)
	}

	@Get('my')
	async getUserTasks(@Request() req, @Query('websiteId') websiteId?: string) {
		return this.tasksService.getUserTasks(req.user.id, websiteId)
	}

	@Get('available')
	async getAvailableTask(@Request() req) {
		return this.tasksService.getAvailableTask(req.user.id)
	}

	@Get('available-queue')
	async getAvailableTasks(@Request() req, @Query('limit') limit?: string) {
		const limitNum = limit ? parseInt(limit, 10) : 10
		return this.tasksService.getAvailableTasks(req.user.id, limitNum)
	}

	@Post(':id/assign')
	async assignTask(@Request() req, @Param('id') taskId: string) {
		return this.tasksService.assignTask(taskId, req.user.id)
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

	@Delete(':id')
	async deleteTask(@Request() req, @Param('id') taskId: string) {
		return this.tasksService.deleteTask(req.user.id, taskId)
	}
}
