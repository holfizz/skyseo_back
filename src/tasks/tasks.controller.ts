import {
	Body,
	Controller,
	Get,
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
}
