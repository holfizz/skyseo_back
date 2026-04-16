import { Body, Controller, Post } from '@nestjs/common'
import { TelegramService } from './telegram.service'

class SendComplaintDto {
	text: string
	contact?: string
	email?: string
}

@Controller('telegram')
export class TelegramController {
	constructor(private telegramService: TelegramService) {}

	@Post('complaint')
	async sendComplaint(@Body() dto: SendComplaintDto) {
		await this.telegramService.sendComplaintNotification(
			dto.text,
			dto.contact,
			dto.email,
		)
		return { success: true, message: 'Сообщение отправлено' }
	}
}
