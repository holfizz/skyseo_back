import { Body, Controller, Get, Post, Request, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { UsersService } from './users.service'
import { PrismaService } from '../prisma/prisma.service'

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
	constructor(
		private usersService: UsersService,
		private prisma: PrismaService,
	) {}

	@Get('profile')
	async getProfile(@Request() req) {
		return this.usersService.getProfile(req.user.id)
	}

	@Get('balance-history')
	async getBalanceHistory(@Request() req) {
		return this.usersService.getBalanceHistory(req.user.id)
	}

	// Одноразовая привязка реферала из профиля (нельзя изменить после установки)
	@Post('claim-referral')
	async claimReferral(@Request() req, @Body('code') code: string) {
		return this.usersService.claimReferral(req.user.id, code)
	}

	// Электронное приложение шлёт этот запрос при запуске и каждый час пока работает
	@Post('heartbeat')
	async heartbeat(@Request() req) {
		await this.prisma.user.update({
			where: { id: req.user.id },
			data: { lastSeenAt: new Date() },
		})
		return { ok: true }
	}
}
