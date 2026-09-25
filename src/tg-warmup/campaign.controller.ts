import {
	Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, UploadedFiles, UseGuards, UseInterceptors,
} from '@nestjs/common'
import { FilesInterceptor } from '@nestjs/platform-express'
import type { Response } from 'express'
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

	// ── стоп-лист ────────────────────────────────────────────────────────────

	/** Кому пул больше не пишет: отказы, блокировки и занесённые вручную. */
	@Get('stop-list')
	stopList(@Query('q') q?: string, @Query('limit') limit?: string) {
		return this.svc.stopList({ q, limit: limit ? Number(limit) : undefined })
	}

	/** Занести вручную: по одному контакту в строке, юзернейм или телефон. */
	@Post('stop-list')
	addStopList(@Body() body: { text: string; reason?: string }) {
		return this.svc.addStopListText(body?.text ?? '', body?.reason)
	}

	/** Убрать одну строку: ошибку автомата исправляет человек. */
	@Delete('stop-list/:id')
	removeStopList(@Param('id') id: string) {
		return this.svc.removeFromStopList(id)
	}

	/** Что уйдёт этому человеку — оба сообщения с подстановками. */
	@Get('recipients/:id/preview')
	preview(@Param('id') id: string) {
		return this.svc.preview(id)
	}

	/** Перенести отправку: другое время и/или другой аккаунт. */
	@Patch('recipients/:id/schedule')
	reschedule(@Param('id') id: string, @Body() body: { at?: string | null; accountId?: string | null }) {
		return this.svc.rescheduleRecipient(id, body ?? {})
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
	/**
	 * Проверить доставку автоматически: читаем переписку и ищем наше исходящее.
	 *
	 * Ручка была только в менеджерском контроллере, а кнопка в админке звала её
	 * по своему адресу — и всегда получала 404.
	 */
	@Post('recipients/:id/check-delivery')
	checkDelivery(@Param('id') id: string) {
		return this.svc.checkDelivery(id)
	}

	@Post('recipients/:id/delivery')
	resolveDelivery(@Param('id') id: string, @Body() body: { delivered: boolean }) {
		return this.svc.resolveDelivery(id, body?.delivered !== false)
	}

	@Get('recipients/:id/dialog')
	dialog(@Param('id') id: string) {
		return this.svc.dialog(id)
	}

	/**
	 * Написать адресату: любой текст, в любой момент, с того же аккаунта.
	 *
	 * Принимает и JSON, и multipart: во втором случае photos — приложенные
	 * картинки, replyTo — id сообщения в Telegram, на которое отвечаем. Поля
	 * multipart приходят строками, поэтому «true» и true здесь равнозначны.
	 */
	@Post('recipients/:id/message')
	@UseInterceptors(FilesInterceptor('photos', 10, { limits: { fileSize: 10 * 1024 * 1024 } }))
	message(
		@Param('id') id: string,
		@UploadedFiles() photos: Express.Multer.File[] | undefined,
		@Body() body: { text?: string; withReport?: boolean | string; replyTo?: number | string },
	) {
		const replyTo = body?.replyTo != null && body.replyTo !== '' ? Number(body.replyTo) : null
		return this.svc.sendManual(id, body?.text ?? '', body?.withReport === true || body?.withReport === 'true', {
			photos: photos?.length
				? photos.map((f, i) => ({ buffer: f.buffer, name: f.originalname || `photo-${i + 1}.jpg`, mime: f.mimetype }))
				: undefined,
			replyToTgId: Number.isFinite(replyTo) ? replyTo : null,
		})
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

	/** Набрать N последних контактов, которым ещё не писали, и создать рассылку. */
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
}
