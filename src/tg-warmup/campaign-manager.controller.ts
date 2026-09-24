import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common'
import type { Response } from 'express'
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

	/** Итог дня: сколько ушло против плана и почему меньше. */
	@Get('day')
	day(@Query('date') date?: string) {
		return this.svc.daySummary(date)
	}

	/** Клиенты по всем рассылкам, разложенные по стадии разговора. */
	@Get('clients')
	clients(@Query('stage') stage?: string, @Query('limit') limit?: string, @Query('q') q?: string) {
		return this.svc.clients(stage, limit ? Number(limit) : undefined, q)
	}

	/** waiting=1 — только те, где последнее сообщение входящее: ждут нас. */
	@Get('conversations')
	conversations(
		@Query('limit') limit?: string,
		@Query('q') q?: string,
		@Query('replied') replied?: string,
		@Query('waiting') waiting?: string,
	) {
		return this.svc.conversations({
			limit: limit ? Number(limit) : undefined,
			q,
			onlyReplied: replied === '1' || replied === 'true',
			waiting: waiting === '1' || waiting === 'true',
		})
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

	/** Что уйдёт этому человеку. Менеджеру нужно так же: он ведёт переписку. */
	@Get('recipients/:id/preview')
	preview(@Param('id') id: string) {
		return this.svc.preview(id)
	}

	@Patch('recipients/:id/schedule')
	reschedule(@Param('id') id: string, @Body() body: { at?: string | null; accountId?: string | null }) {
		return this.svc.rescheduleRecipient(id, body ?? {})
	}

	@Delete('recipients/:id')
	removeRecipient(@Param('id') id: string) {
		return this.svc.removeRecipient(id)
	}

	/** Все переписки одного аккаунта, порциями. */
	@Get('accounts/:id/dialogs')
	accountDialogs(
		@Param('id') id: string,
		@Query('limit') limit?: string,
		@Query('cursor') cursor?: string,
		@Query('stage') stage?: string,
	) {
		return this.svc.accountDialogs(id, { limit: limit ? Number(limit) : undefined, cursor, stage })
	}

	/** Закрыть вопрос по отправке с неизвестным исходом. */
	@Post('recipients/:id/delivery')
	resolveDelivery(@Param('id') id: string, @Body() body: { delivered: boolean }) {
		return this.svc.resolveDelivery(id, body?.delivered !== false)
	}

	/** Проверить доставку автоматически: читаем переписку и ищем наше исходящее. */
	@Post('recipients/:id/check-delivery')
	checkDelivery(@Param('id') id: string) {
		return this.svc.checkDelivery(id)
	}

	@Get('recipients/:id/dialog')
	dialog(@Param('id') id: string) {
		return this.svc.dialog(id)
	}

	@Post('recipients/:id/message')
	message(@Param('id') id: string, @Body() body: { text: string; withReport?: boolean }) {
		return this.svc.sendManual(id, body?.text, !!body?.withReport)
	}

	/** Исправить своё сообщение в переписке. */
	@Patch('recipients/:id/messages/:messageId')
	editMessage(@Param('id') id: string, @Param('messageId') messageId: string, @Body() body: { text: string }) {
		return this.svc.editMessage(id, messageId, body?.text)
	}

	/** Голосовое, кружок или видео из переписки — чтобы прослушать прямо в чате. */
	@Get('recipients/:id/messages/:messageId/media')
	async media(@Param('id') id: string, @Param('messageId') messageId: string, @Res() res: Response) {
		const file = await this.svc.messageMedia(id, messageId)
		res.setHeader('Content-Type', file.mime)
		res.send(file.buffer)
	}

	/** Удалить сообщение: ?forBoth=1 — у обоих, иначе только у нас. */
	@Delete('recipients/:id/messages/:messageId')
	deleteMessage(@Param('id') id: string, @Param('messageId') messageId: string, @Query('forBoth') forBoth?: string) {
		return this.svc.deleteMessage(id, messageId, forBoth === '1')
	}

	/** PDF-отчёт адресата: открыть и посмотреть перед отправкой. Счётчик открытий лида не трогает. */
	@Get('recipients/:id/report')
	async report(@Param('id') id: string, @Res() res: Response) {
		const pdf = await this.svc.reportPdf(id)
		res.setHeader('Content-Type', 'application/pdf')
		res.setHeader('Content-Disposition', `inline; filename="${pdf.name}"`)
		res.send(pdf.buffer)
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
