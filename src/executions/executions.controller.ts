import {
	Body,
	Controller,
	Get,
	Headers,
	Ip,
	Param,
	Post,
	Put,
	Request,
	UseGuards,
} from '@nestjs/common'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { CompleteExecutionDto, StartExecutionDto } from './dto'
import { ExecutionsService } from './executions.service'

@Controller('executions')
@UseGuards(JwtAuthGuard)
export class ExecutionsController {
	constructor(private executionsService: ExecutionsService) {}

	@Post('start')
	async start(
		@Request() req,
		@Body() dto: StartExecutionDto,
		@Ip() ip: string,
		@Headers('user-agent') userAgent: string,
	) {
		return this.executionsService.startExecution(
			dto.taskId,
			req.user.id,
			ip,
			userAgent,
		)
	}

	@Put(':id/complete')
	async complete(@Param('id') id: string, @Body() dto: CompleteExecutionDto) {
		return this.executionsService.completeExecution(id, dto)
	}

	@Get('history')
	async getHistory(@Request() req) {
		return this.executionsService.getExecutionHistory(req.user.id)
	}
}
