import { Controller, Get, Request, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { RewardsService } from './rewards.service'

@Controller('rewards')
@UseGuards(JwtAuthGuard)
export class RewardsController {
	constructor(private rewards: RewardsService) {}

	// Данные для экрана стрика в приложении.
	// Сначала начисляем за сегодня (идемпотентно), потом отдаём — иначе при открытии
	// экрана огонёк за сегодня не появится, пока не отработает heartbeat (гонка fetch↔claim).
	@Get('streak')
	async getStreak(@Request() req) {
		await this.rewards.claimDaily(req.user.id, req.user.isSuspicious).catch(() => {})
		return this.rewards.getStreak(req.user.id)
	}
}
