import { Body, Controller, HttpException, HttpStatus, Ip, Post, UseGuards } from '@nestjs/common'
import { IsArray, IsEmail, IsObject, IsOptional, IsString } from 'class-validator'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
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

class CaptchaAlertDto {
	@IsString()
	engine: string

	@IsString()
	keyword: string

	@IsString()
	websiteUrl: string

	@IsString()
	userEmail: string

	@IsObject()
	browserProfile: {
		userAgent: string
		screenWidth: number
		screenHeight: number
		webGLVendor: string
		webGLRenderer: string
	}

	@IsArray()
	dailyQueryLog: Array<{ ts: string; engine: string; keyword: string; websiteUrl: string }>
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

	@UseGuards(JwtAuthGuard)
	@Post('captcha-alert')
	async sendCaptchaAlert(@Body() dto: CaptchaAlertDto) {
		await this.telegramService.sendCaptchaAlertNotification(dto)
		return { success: true }
	}
}
