import {
	Body,
	Controller,
	Get,
	HttpCode,
	Param,
	Post,
	Request,
	UseGuards,
} from '@nestjs/common'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { CreatePaymentDto } from './dto'
import { PaymentsService } from './payments.service'

@Controller('payments')
export class PaymentsController {
	constructor(private paymentsService: PaymentsService) {}

	@Post()
	@UseGuards(JwtAuthGuard)
	async createPayment(@Request() req, @Body() dto: CreatePaymentDto) {
		return this.paymentsService.createPayment(req.user.id, dto)
	}

	@Get('history')
	@UseGuards(JwtAuthGuard)
	async getPaymentHistory(@Request() req) {
		return this.paymentsService.getPaymentHistory(req.user.id)
	}

	@Post('webhook')
	@HttpCode(200)
	async handleWebhook(@Body() body: any) {
		return this.paymentsService.handleYooKassaWebhook(body)
	}

	@Get(':id/status')
	@UseGuards(JwtAuthGuard)
	async getPaymentStatus(@Request() req, @Param('id') id: string) {
		return this.paymentsService.getPaymentStatus(id, req.user.id)
	}
}
