/**
 * HTTP-слой доставки алгоритма. Два контроллера:
 *   AlgorithmController      — для ПК (JWT исполнителя): взять текущий бандл, отчитаться.
 *   AlgorithmAdminController — для владельца (JWT + AdminGuard): загрузка, выкатка, откат, kill.
 */
import { Body, Controller, Get, Param, Post, Request, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { AdminGuard } from '../admin/admin.guard'
import { AlgorithmService } from './algorithm.service'

@Controller('algorithm')
@UseGuards(JwtAuthGuard)
export class AlgorithmController {
	constructor(private algo: AlgorithmService) {}

	// ПК спрашивает раз в сутки (с джиттером). Отдаём готовый подписанный бандл или kill.
	@Get('current')
	current(@Request() req) {
		return this.algo.currentForExecutor(req.user.id)
	}

	// ПК сообщает, какую версию реально применил и с какой ошибкой (телеметрия применения).
	@Post('report')
	report(@Request() req, @Body() body: { appliedVersion?: number | null; appVersion?: string | null; lastError?: string | null }) {
		return this.algo.report(req.user.id, body?.appliedVersion ?? null, body?.appVersion ?? null, body?.lastError ?? null)
	}
}

@Controller('admin/algorithm')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AlgorithmAdminController {
	constructor(private algo: AlgorithmService) {}

	@Get()
	list() {
		return this.algo.list()
	}

	// Загрузка готового подписанного бандла (JSON из algo-sign.js). Подпись проверяется на сервере.
	@Post()
	create(@Request() req, @Body() body: { bundle: unknown; label?: string; notes?: string }) {
		return this.algo.createBundle(body?.bundle, body?.label ?? '', body?.notes ?? null, req.user?.email ?? null)
	}

	@Post(':version/promote')
	promote(@Param('version') version: string) {
		return this.algo.promote(Number(version))
	}

	@Post(':version/canary')
	canary(@Param('version') version: string, @Body() body: { userIds: string[] }) {
		return this.algo.canary(Number(version), body?.userIds ?? [])
	}

	@Post(':version/rollback')
	rollback(@Param('version') version: string, @Body() body: { reason?: string }) {
		return this.algo.rollback(Number(version), body?.reason ?? null)
	}

	@Post('kill')
	kill(@Body() body: { on: boolean }) {
		return this.algo.setKill(!!body?.on)
	}
}
