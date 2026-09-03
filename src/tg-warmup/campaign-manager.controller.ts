import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { SprintGuard } from '../sprint/sprint.guard'
import { CampaignService } from './campaign.service'

/**
 * Рассылка в кабинете менеджера.
 *
 * Отдельный контроллер, а не общий с админкой, потому что права разные:
 * менеджер работает с рассылкой, но не настраивает её. Ему доступны воронка,
 * кампании, адресаты, переписка, отправка сообщений, синхронизация, набор
 * контактов из базы и запуск с паузой.
 *
 * Чего здесь НЕТ намеренно: тексты, лимиты, выбор аккаунтов, удаление кампаний
 * и всё, что связано с самими аккаунтами и прокси. Это настройки владельца,
 * а не рабочий инструмент; менеджеру их менять незачем, а сломать — легко.
 */
@Controller('manager/outreach')
@UseGuards(JwtAuthGuard, SprintGuard)
export class CampaignManagerController {
	constructor(private svc: CampaignService) {}

	@Get()
	async overview() {
		const [funnel, campaigns] = await Promise.all([this.svc.overallFunnel(), this.svc.list()])
		return { funnel, campaigns }
	}

	@Get('campaigns/:id')
	card(@Param('id') id: string) {
		return this.svc.card(id)
	}

	/** Календарь отправок. Менеджеру он нужен так же: он ведёт переписку. */
	/** Что с рассылкой сегодня: идёт ли, сколько ушло, когда следующее. */
	@Get('today')
	today() {
		return this.svc.today()
	}

	/** Клиенты по всем рассылкам, разложенные по стадии разговора. */
	@Get('clients')
	clients(@Query('stage') stage?: string, @Query('limit') limit?: string, @Query('q') q?: string) {
		return this.svc.clients(stage, limit ? Number(limit) : undefined, q)
	}

	/** Остановить совсем: адресаты остаются, расписание снимается. */
	@Post('campaigns/:id/cancel')
	cancel(@Param('id') id: string) {
		return this.svc.cancel(id)
	}

	@Get('campaigns/:id/calendar')
	calendar(@Param('id') id: string) {
		return this.svc.calendar(id)
	}

	@Post('campaigns/:id/schedule')
	schedule(@Param('id') id: string) {
		return this.svc.buildSchedule(id)
	}

	@Get('campaigns/:id/recipients')
	recipients(@Param('id') id: string, @Query('status') status?: string, @Query('limit') limit?: string) {
		return this.svc.recipients(id, status, limit ? Number(limit) : undefined)
	}

	@Get('recipients/:id/dialog')
	dialog(@Param('id') id: string) {
		return this.svc.dialog(id)
	}

	@Post('recipients/:id/message')
	message(@Param('id') id: string, @Body() body: { text: string }) {
		return this.svc.sendManual(id, body?.text)
	}

	/** Подробная статистика — только для окна, которое открывают по кнопке. */
	@Get('stats')
	stats(@Query('days') days?: string) {
		return this.svc.stats(days ? Number(days) : undefined)
	}

	@Post('sync')
	sync(@Body() body?: { campaignId?: string }) {
		return this.svc.pollTick({ campaignId: body?.campaignId, deadlineMs: 40_000 })
	}

	@Post('recipients/:id/sync')
	syncOne(@Param('id') id: string) {
		return this.svc.pollTick({ recipientId: id, deadlineMs: 40_000 })
	}

	@Post('quick')
	quick(@Body() body: {
		count?: number; campaignId?: string; windowFrom?: number; windowTo?: number
		start?: boolean; date?: string; force?: boolean
	}) {
		return this.svc.quickFill(body?.count ?? 20, body?.campaignId, {
			windowFrom: body?.windowFrom,
			windowTo: body?.windowTo,
			start: body?.start,
			date: body?.date,
			force: body?.force,
		})
	}

	@Post('campaigns/:id/status')
	status(@Param('id') id: string, @Body() body: { status: 'RUNNING' | 'PAUSED' | 'DONE' }) {
		return this.svc.setStatus(id, body?.status)
	}

	@Post('campaigns/:id/recipients/from-leads')
	addFromLeads(@Param('id') id: string, @Body() body: { limit?: number }) {
		return this.svc.addRecipientsFromLeads(id, body?.limit ?? 20)
	}
}
