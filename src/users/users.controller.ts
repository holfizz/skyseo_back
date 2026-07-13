import { Body, Controller, Get, Post, Request, UseGuards } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { RewardsService } from '../rewards/rewards.service'
import { UsersService } from './users.service'
import { PrismaService } from '../prisma/prisma.service'
import { WinbackService } from '../winback/winback.service'

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
	constructor(
		private usersService: UsersService,
		private prisma: PrismaService,
		private rewards: RewardsService,
		private winback: WinbackService,
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

	// Электронное приложение шлёт этот запрос при запуске и каждый час пока работает.
	// Обновляем lastSeenAt; и если юзер был помечен UNINSTALLED (инференс крона или Windows-beacon),
	// но снова шлёт heartbeat — приложение живо прямо сейчас → возвращаем ACTIVE. После реального
	// удаления heartbeat'ов нет, поэтому UNINSTALLED не «оживёт» ложно.
	@Post('heartbeat')
	async heartbeat(@Request() req, @Body('appVersion') appVersion?: string) {
		// req.user грузится свежим из БД на каждый запрос (JwtStrategy), поэтому статус актуален.
		// Если он был UNINSTALLED — этот heartbeat и есть возврат (edge UNINSTALLED→ACTIVE).
		const wasUninstalled = req.user.appStatus === 'UNINSTALLED'

		await this.prisma.$executeRaw`
			UPDATE users
			SET "lastSeenAt" = NOW(),
				"appStatus" = CASE WHEN "appStatus" = 'UNINSTALLED'::"AppStatus"
					THEN 'ACTIVE'::"AppStatus" ELSE "appStatus" END
			WHERE id = ${req.user.id}
		`
		if (appVersion) {
			await this.prisma.user.update({
				where: { id: req.user.id },
				data: { appVersion },
			})
		}
		// Ежедневная награда за онлайн: раз в сутки, пока приложение шлёт heartbeat.
		// Не роняем heartbeat, если начисление вдруг упало.
		await this.rewards
			.claimDaily(req.user.id, req.user.isSuspicious)
			.catch(() => {})
		// Win-back: вернулся после письма → +500 (один раз) + пинг владельцу. Метод сам не бросает.
		if (wasUninstalled) {
			await this.winback.onReturn(req.user.id)
		}
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
