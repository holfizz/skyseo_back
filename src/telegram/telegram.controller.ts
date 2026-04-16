import { Body, Controller, Post, Request, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { TelegramService } from './telegram.service'

class SendComplaintDto {
	text: string
	contact?: string
}

@Controller('telegram')
export class TelegramController {
	constructor(private telegramService: TelegramService) {}

	@Post('complaint')
	@UseGuards(JwtAuthGuard)
	async sendComplaint(@Body() dto: SendComplaintDto, @Request() req) {
		await this.telegramService.sendComplaintNotification(
			dto.text,
			dto.contact,
			req.user.email,
		)
		return { success: true, message: 'Жалоба отправлена' }
	}
}
