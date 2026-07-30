import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common'
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

	// ——— Операции над клиентом ———

	// Добавить сайт + ключи клиенту
	@Post('clients/:id/sites')
	addSite(
		@Param('id') id: string,
		@Body()
		body: { name?: string; url: string; city?: string; keywords: string[]; autoMaxVisits?: boolean; maxVisits?: number },
	) {
		return this.manager.addSite(id, body)
	}

	// Заметки (клиент не видит)
	@Get('clients/:id/notes')
	listNotes(@Param('id') id: string) {
		return this.manager.listNotes(id)
	}

	@Post('clients/:id/notes')
	addNote(@Param('id') id: string, @Body() body: { text: string }, @CurrentUser() user: any) {
		return this.manager.addNote(id, user?.email ?? 'неизвестно', body?.text)
	}

	@Delete('notes/:noteId')
	deleteNote(@Param('noteId') noteId: string) {
		return this.manager.deleteNote(noteId)
	}

	// Выбить чек (провести оплату вручную) — фиксируем оператора из токена
	@Post('clients/:id/payment')
	issuePayment(
		@Param('id') id: string,
		@Body() body: { amount: number; points: number },
		@CurrentUser() user: any,
	) {
		return this.manager.issuePayment(id, body, user?.email ?? 'неизвестно')
	}

	// Удаление с подтверждением (подтверждение на фронте)
	@Delete('sites/:siteId')
	deleteSite(@Param('siteId') siteId: string) {
		return this.manager.deleteSite(siteId)
	}

	@Delete('keywords/:taskId')
	deleteKeyword(@Param('taskId') taskId: string) {
		return this.manager.deleteKeyword(taskId)
	}

	// Проверить позиции сайта в Яндексе: домен + ключи + (опц.) город
	@Post('check-positions')
	checkPositions(@Body() body: { domain: string; keywords: string[]; city?: string }) {
		return this.manager.checkPositions(body)
	}
}
