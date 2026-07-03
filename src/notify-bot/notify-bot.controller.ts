import { Controller, Get, Post, Request, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { NotifyBotService } from './notify-bot.service'

@Controller('notify-bot')
export class NotifyBotController {
	constructor(private notifyBot: NotifyBotService) {}

	// Сгенерировать код и deep-link для привязки Telegram
	@Post('link-code')
	@UseGuards(JwtAuthGuard)
	async linkCode(@Request() req) {
		return this.notifyBot.generateLinkCode(req.user.id)
	}

	@Get('status')
	@UseGuards(JwtAuthGuard)
	async status(@Request() req) {
		return this.notifyBot.getStatus(req.user.id)
	}

	@Post('unlink')
	@UseGuards(JwtAuthGuard)
	async unlink(@Request() req) {
		await this.notifyBot.unlink(req.user.id)
		return { ok: true }
	}
}
