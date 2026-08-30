import { Body, Controller, Get, Param, Post, Put, Query, Request, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { AdminGuard } from '../admin/admin.guard'
import { SprintGuard } from './sprint.guard'
import { SprintService } from './sprint.service'
import { ManagerService } from '../manager/manager.service'

/**
 * Кабинет менеджера: план на день, очередь контактов, разбор недели.
 *
 * Префикс /manager свободен: прежний кабинет менеджера удалён, его работа
 * переехала в CRM (см. комментарий в manager.module.ts). ManagerService оттуда
 * — про карточки клиентов и к этому кабинету отношения не имеет.
 */
@Controller('manager')
@UseGuards(JwtAuthGuard, SprintGuard)
export class SprintController {
	constructor(
		private svc: SprintService,
		private manager: ManagerService,
	) {}

	@Get('dashboard')
	dashboard() {
		return this.svc.getDashboard()
	}

	@Get('queue')
	queue(@Query('limit') limit?: string) {
		return this.svc.getQueue(limit ? Number(limit) : undefined)
	}

	@Post('sent')
	markSent(@Request() req, @Body() body: { leadId: string; step: number }) {
		return this.svc.markSent(req.user.id, body.leadId, Number(body.step))
	}

	@Post('review')
	review(@Request() req, @Body() body: { sprintId: string; comment: string }) {
		return this.svc.submitReview(req.user.id, body.sprintId, body.comment)
	}

	/**
	 * Начислить клиенту баллы после оплаты на счёт. Единственный способ пополнить
	 * баланс: самостоятельная покупка на сайте закрыта (payments.controller.ts).
	 *
	 * Ручка живёт здесь, а не в админке: AdminGuard навешен на весь AdminController,
	 * и добавление роли MANAGER туда открыло бы ей около шестидесяти админских роутов.
	 * Сама логика не дублируется, зовём готовый ManagerService.issuePayment.
	 */
	@Post('clients/:id/points')
	issuePoints(
		@Param('id') clientId: string,
		@Body() body: { amount: number; points: number; days?: number },
		@Request() req,
	) {
		return this.manager.issuePayment(clientId, body, req.user?.email ?? 'менеджер')
	}
}

// Админская часть: KPI и правка целей. Отдельный контроллер — другой доступ.
@Controller('admin')
@UseGuards(JwtAuthGuard, AdminGuard)
export class SprintAdminController {
	constructor(private svc: SprintService) {}

	@Get('kpi')
	kpi() {
		return this.svc.getKpi()
	}

	@Get('sprints')
	sprints() {
		return this.svc.listSprints()
	}

	/** Правка целей: и недельной, и дневной, и по сети. */
	@Put('sprints/:id')
	updateSprint(
		@Param('id') id: string,
		@Body() body: { messagesWeek?: number; messagesDay?: number; networkTarget?: number; focus?: string },
	) {
		return this.svc.updateSprint(id, body)
	}
}
