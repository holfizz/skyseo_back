import { Controller, Get, Request, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { RewardsService } from './rewards.service'

@Controller('rewards')
@UseGuards(JwtAuthGuard)
export class RewardsController {
	constructor(private rewards: RewardsService) {}

	// Данные для экрана стрика в приложении. Начисление идёт на heartbeat, здесь только чтение.
	@Get('streak')
	async getStreak(@Request() req) {
		return this.rewards.getStreak(req.user.id)
	}
}
