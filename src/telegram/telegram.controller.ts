import { Body, Controller, HttpException, HttpStatus, Ip, Post } from '@nestjs/common'
import { IsEmail, IsOptional, IsString } from 'class-validator'
import { TelegramService } from './telegram.service'

class SendComplaintDto {
	@IsString()
	text: string

	@IsOptional()
	@IsString()
	contact?: string

	@IsOptional()
	@IsEmail()
	email?: string
}

class SendContactFormDto {
	@IsString()
	name: string

	@IsEmail()
	email: string

	@IsOptional()
	@IsString()
	phone?: string

	@IsString()
	message: string
}

@Controller('telegram')
export class TelegramController {
	private readonly complaintLastSent = new Map<string, number>()

	constructor(private telegramService: TelegramService) {}

	@Post('complaint')
	async sendComplaint(@Body() dto: SendComplaintDto, @Ip() ip: string) {
		const now = Date.now()
		const last = this.complaintLastSent.get(ip) ?? 0
		if (now - last < 60_000) {
			throw new HttpException('Слишком много запросов. Попробуйте через минуту.', HttpStatus.TOO_MANY_REQUESTS)
		}
		this.complaintLastSent.set(ip, now)

		console.log('[TelegramController] Received complaint:', dto)

		await this.telegramService.sendComplaintNotification(
			dto.text,
			dto.contact,
			dto.email,
		)
		return { success: true, message: 'Сообщение отправлено' }
	}

	@Post('contact-form')
	async sendContactForm(@Body() dto: SendContactFormDto) {
		await this.telegramService.sendContactFormNotification(dto)
		return { success: true, message: 'Заявка отправлена' }
	}
}
