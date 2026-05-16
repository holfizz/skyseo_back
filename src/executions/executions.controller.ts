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
import { SkipThrottle } from '@nestjs/throttler'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import {
	CompleteExecutionDto,
	CreditEngineDto,
	FailExecutionDto,
	LogExecutionEventDto,
	StartExecutionDto,
} from './dto'
import { ExecutionsService } from './executions.service'

@SkipThrottle({ short: true, medium: true })
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
		try {
			return await this.executionsService.completeExecution(id, dto)
		} catch (e: any) {
			console.error('[complete] ERROR:', e?.message, e?.stack?.split('\n')[1])
			throw e
		}
	}

	@Post(':id/credit-engine')
	async creditEngine(@Param('id') id: string, @Body() dto: CreditEngineDto) {
		try {
			return await this.executionsService.creditEngine(id, dto)
		} catch (e: any) {
			console.error('[credit-engine] ERROR:', e?.message, e?.stack?.split('\n')[1])
			throw e
		}
	}

	@Put(':id/fail')
	async fail(@Param('id') id: string, @Body() dto: FailExecutionDto) {
		return this.executionsService.failExecution(id, dto)
	}

	@Post(':id/events')
	async logEvent(
		@Param('id') id: string,
		@Request() req,
		@Body() dto: LogExecutionEventDto,
	) {
		return this.executionsService.logExecutionEvent(id, req.user.id, dto)
	}

	@Get('history')
	async getHistory(@Request() req) {
		return this.executionsService.getExecutionHistory(req.user.id)
	}

	@Post('captcha-event')
	async logCaptcha(
		@Request() req,
		@Body() body: { engine: string; resolved: boolean },
	) {
		return this.executionsService.logCaptchaEvent(req.user.id, body.engine, body.resolved)
	}
}
