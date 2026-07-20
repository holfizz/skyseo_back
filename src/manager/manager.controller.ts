import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { CurrentUser } from '../common/decorators/user.decorator'
import { ManagerGuard } from './manager.guard'
import { ManagerService } from './manager.service'

function parseLimit(raw?: string): number {
	const n = Number(raw)
	if (!Number.isFinite(n)) return 100
	return Math.min(Math.max(Math.trunc(n), 1), 500)
}

@Controller('manager')
@UseGuards(JwtAuthGuard, ManagerGuard)
export class ManagerController {
	constructor(private manager: ManagerService) {}

	@Get('clients')
	listClients() {
		return this.manager.listClients()
	}

	@Get('clients/:id')
	getClient(@Param('id') id: string) {
		return this.manager.getClient(id)
	}

	@Get('clients/:id/logs')
	getClientLogs(@Param('id') id: string, @Query('limit') limit?: string) {
		return this.manager.getClientLogs(id, parseLimit(limit))
	}

	// Отдельный сегмент после :id — 'clients/:id' его не перехватывает (как и у logs).
	@Get('clients/:id/trend')
	getClientTrend(@Param('id') id: string) {
		return this.manager.getClientTrend(id)
	}

	@Get('outreach')
	getOutreach() {
		return this.manager.getOutreach()
	}

	@Get('executions/:id/trace')
	getTrace(@Param('id') id: string, @CurrentUser() user: any) {
		return this.manager.getTrace(id, user)
	}
}
