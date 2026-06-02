import { Body, Controller, Get, Post, Request, UseGuards } from '@nestjs/common'
import { randomUUID } from 'crypto'
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

	// Windows-приложение запрашивает стабильный токен и пишет его в реестр,
	// чтобы деинсталлятор смог пингануть /auth/app-uninstall-beacon при удалении.
	@Get('uninstall-token')
	async getUninstallToken(@Request() req) {
		const user = await this.prisma.user.findUnique({
			where: { id: req.user.id },
			select: { uninstallToken: true },
		})
		let token = user?.uninstallToken
		if (!token) {
			token = randomUUID()
			await this.prisma.user.update({
				where: { id: req.user.id },
				data: { uninstallToken: token },
			})
		}
		return { token }
	}
}
