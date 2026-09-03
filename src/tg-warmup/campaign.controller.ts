import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { AdminGuard } from '../admin/admin.guard'
import { CampaignService } from './campaign.service'

/** Рассылка в Telegram: кампании, адресаты, переписка, воронка. */
@Controller('admin/tg-outreach')
@UseGuards(JwtAuthGuard, AdminGuard)
export class CampaignController {
	constructor(private svc: CampaignService) {}

	/** Шапка раздела: общая воронка плюс список кампаний со своими воронками. */
	@Get()
	async overview() {
		const [funnel, campaigns] = await Promise.all([this.svc.overallFunnel(), this.svc.list()])
		return { funnel, campaigns }
	}

	/**
	 * Синхронизация по кнопке: сходить в Telegram прямо сейчас и забрать всё —
	 * кто прочитал, кто ответил, что написал. Расписание делает то же самое раз
	 * в минуту, но ждать минуту после собственного ответа неудобно.
	 */
	/** Подробная статистика — только для окна, которое открывают по кнопке. */
	@Get('stats')
	stats(@Query('days') days?: string) {
		return this.svc.stats(days ? Number(days) : undefined)
	}

	@Post('sync')
	sync(@Body() body?: { campaignId?: string }) {
		// Предел по времени обязателен именно здесь: на том конце ждёт браузер,
		// а один аккаунт с отвалившимся прокси стоит двадцать секунд. Что не
		// успели — вернём в ответе, кнопку можно нажать ещё раз.
		return this.svc.pollTick({ campaignId: body?.campaignId, deadlineMs: 40_000 })
	}

	/** То же, но для одной переписки: дешевле, когда открыт конкретный диалог. */
	@Post('recipients/:id/sync')
	syncOne(@Param('id') id: string) {
		return this.svc.pollTick({ recipientId: id, deadlineMs: 40_000 })
	}

	@Post('campaigns')
	create(@Body() body: any) {
		return this.svc.create(body)
	}

	@Get('campaigns/:id')
	card(@Param('id') id: string) {
		return this.svc.card(id)
	}

	@Patch('campaigns/:id')
	update(@Param('id') id: string, @Body() body: any) {
		return this.svc.update(id, body)
	}

	@Delete('campaigns/:id')
	remove(@Param('id') id: string) {
		return this.svc.remove(id)
	}

	@Post('campaigns/:id/status')
	status(@Param('id') id: string, @Body() body: { status: 'RUNNING' | 'PAUSED' | 'DONE' }) {
		return this.svc.setStatus(id, body?.status)
	}

	@Post('campaigns/:id/accounts')
	accounts(@Param('id') id: string, @Body() body: { accountIds: string[] }) {
		return this.svc.setAccounts(id, body?.accountIds ?? [])
	}

	/** Пробная отправка себе: проверить текст и связку «аккаунт + прокси». */
	@Post('campaigns/:id/test')
	test(@Param('id') id: string, @Body() body: { accountId: string; target: string; recipientId?: string }) {
		return this.svc.testSend(id, body?.accountId, body?.target, body?.recipientId)
	}

	/** Календарь отправок: по дням, с временем и аккаунтом каждого сообщения. */
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

	/** Раздать дневную цель по аккаунтам руками. */
	@Post('campaigns/:id/limits')
	limits(@Param('id') id: string, @Body() body: { limits: Record<string, number | null> }) {
		return this.svc.setLimits(id, body?.limits ?? {})
	}

	@Get('campaigns/:id/calendar')
	calendar(@Param('id') id: string) {
		return this.svc.calendar(id)
	}

	/** Пересобрать расписание: после смены окна, состава аккаунтов или норм. */
	@Post('campaigns/:id/schedule')
	schedule(@Param('id') id: string) {
		return this.svc.buildSchedule(id)
	}

	/** Вернуть текст к заготовке из кода. */
	@Post('campaigns/:id/reset-text')
	resetText(@Param('id') id: string) {
		return this.svc.resetText(id)
	}

	@Get('campaigns/:id/recipients')
	recipients(@Param('id') id: string, @Query('status') status?: string, @Query('limit') limit?: string) {
		return this.svc.recipients(id, status, limit ? Number(limit) : undefined)
	}

	@Post('campaigns/:id/recipients')
	addRecipients(@Param('id') id: string, @Body() body: { text: string }) {
		return this.svc.addRecipientsFromText(id, body?.text ?? '')
	}

	@Post('campaigns/:id/recipients/from-leads')
	addFromLeads(@Param('id') id: string, @Body() body: { limit?: number }) {
		return this.svc.addRecipientsFromLeads(id, body?.limit ?? 200)
	}

	@Delete('recipients/:id')
	removeRecipient(@Param('id') id: string) {
		return this.svc.removeRecipient(id)
	}

	@Get('recipients/:id/dialog')
	dialog(@Param('id') id: string) {
		return this.svc.dialog(id)
	}

	/** Написать адресату: любой текст, в любой момент, с того же аккаунта. */
	@Post('recipients/:id/message')
	message(@Param('id') id: string, @Body() body: { text: string }) {
		return this.svc.sendManual(id, body?.text)
	}

	/** Набрать N последних контактов, которым ещё не писали, и создать рассылку. */
	@Post('quick')
	quick(@Body() body: { count?: number; campaignId?: string; windowFrom?: number; windowTo?: number; start?: boolean }) {
		return this.svc.quickFill(body?.count ?? 20, body?.campaignId, {
			windowFrom: body?.windowFrom,
			windowTo: body?.windowTo,
			start: body?.start,
		})
	}
}
