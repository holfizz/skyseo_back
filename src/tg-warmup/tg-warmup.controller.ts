import {
	Body, Controller, Delete, Get, Param, Post, Put, Query, UploadedFiles, UseGuards, UseInterceptors,
} from '@nestjs/common'
import { FilesInterceptor } from '@nestjs/platform-express'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { AdminGuard } from '../admin/admin.guard'
import { TgWarmupService } from './tg-warmup.service'

/**
 * Прогрев Telegram — раздел админки.
 *
 * Отдельный контроллер, а не роуты в AdminController: там на всём классе висит
 * один AdminGuard и уже под сотню ручек, и добавление в него чего угодно
 * расширяет и без того широкую поверхность. Здесь же лежат ключи от чужих
 * аккаунтов — тем более незачем.
 */
@Controller('admin/warmup')
@UseGuards(JwtAuthGuard, AdminGuard)
export class TgWarmupController {
	constructor(private svc: TgWarmupService) {}

	// ── прокси ───────────────────────────────────────────────────────────────

	@Get('proxies')
	proxies() {
		return this.svc.listProxies()
	}

	@Post('proxies')
	addProxies(@Body() body: { text: string }) {
		return this.svc.addProxies(body?.text ?? '')
	}

	@Delete('proxies/:id')
	deleteProxy(@Param('id') id: string) {
		return this.svc.deleteProxy(id)
	}

	@Post('proxies/check-all')
	checkAllProxies(@Body() body?: { onlyNew?: boolean }) {
		return this.svc.checkAllProxies(!!body?.onlyNew)
	}

	@Post('proxies/assign')
	assignProxies() {
		return this.svc.assignProxies()
	}

	@Post('proxies/:id/check')
	checkProxy(@Param('id') id: string) {
		return this.svc.checkProxy(id)
	}

	// ── аккаунты ─────────────────────────────────────────────────────────────

	@Get('accounts')
	accounts() {
		return this.svc.listAccounts()
	}

	@Get('accounts/:id')
	account(@Param('id') id: string) {
		return this.svc.accountCard(id)
	}

	/**
	 * Загрузка сессий. Ограничение по размеру задано явно: у multer его по
	 * умолчанию нет вовсе, и архив на гигабайт лёг бы целиком в память.
	 */
	@Post('accounts/import')
	@UseInterceptors(FilesInterceptor('files', 50, { limits: { fileSize: 60 * 1024 * 1024 } }))
	importAccounts(
		@UploadedFiles() files: Express.Multer.File[],
		@Body() body: {
			strings?: string; apiId?: string; apiHash?: string; passcode?: string
			proxyMode?: 'pool' | 'one' | 'none'; proxyId?: string
		},
	) {
		return this.svc.importAccounts({
			files: (files ?? []).map(f => ({ name: f.originalname, buffer: f.buffer })),
			strings: body?.strings,
			apiId: body?.apiId ? Number(body.apiId) : undefined,
			apiHash: body?.apiHash || undefined,
			passcode: body?.passcode || undefined,
			proxyMode: body?.proxyMode ?? 'pool',
			proxyId: body?.proxyId || null,
		})
	}

	@Delete('accounts/:id')
	deleteAccount(@Param('id') id: string) {
		return this.svc.deleteAccount(id)
	}

	@Post('accounts/:id/proxy')
	setProxy(@Param('id') id: string, @Body() body: { proxyId: string | null }) {
		return this.svc.setProxy(id, body?.proxyId ?? null)
	}

	/** Чем аккаунту заниматься: WARM — только греться, SEND — только рассылать, BOTH — и то и другое. */
	@Post('accounts/:id/mode')
	mode(@Param('id') id: string, @Body() body: { mode: string }) {
		return this.svc.setMode(id, body?.mode)
	}

	/** Полная пауза аккаунта: ни рассылки, ни прогрева. */
	/**
	 * Разрешить рассылку с непрогретого аккаунта — решение владельца.
	 *
	 * Ручка в разделе прогрева, а не рассылки: флаг живёт на аккаунте и
	 * действует во всех кампаниях сразу.
	 */
	@Post('accounts/:id/force-send')
	forceSend(@Param('id') id: string, @Body() body: { force: boolean }) {
		return this.svc.setForceSend(id, body?.force !== false)
	}

	@Post('accounts/:id/pause')
	pause(@Param('id') id: string, @Body() body: { paused: boolean }) {
		return this.svc.pauseAccount(id, body?.paused !== false)
	}

	@Post('accounts/:id/check')
	check(@Param('id') id: string) {
		return this.svc.checkAccount(id)
	}

	/**
	 * Разговор со @SpamBot. Одна ручка на три шага: спросить статус, нажать
	 * кнопку из его ответа, отправить произвольный текст в обращении.
	 */
	@Post('accounts/:id/spam')
	spam(@Param('id') id: string, @Body() body: { action?: 'status' | 'press' | 'text'; index?: number; text?: string }) {
		if (body?.action === 'press') return this.svc.spamBot(id, { kind: 'press', index: Number(body.index ?? 0) })
		if (body?.action === 'text') return this.svc.spamBot(id, { kind: 'text', text: String(body.text ?? '') })
		return this.svc.spamBot(id, { kind: 'status' })
	}

	/** Лента прогрева: план на сегодня, что идёт сейчас, что уже сделано. */
	@Get('accounts/:id/timeline')
	timeline(@Param('id') id: string) {
		return this.svc.timeline(id)
	}

	/**
	 * Общая лента по всему пулу: действия прогрева, события аккаунтов и отправки
	 * рассылки в одном списке. filter=errors показывает только отказы.
	 */
	@Get('activity')
	activity(
		@Query('filter') filter?: 'all' | 'errors' | 'ok',
		@Query('accountId') accountId?: string,
		@Query('limit') limit?: string,
	) {
		return this.svc.activity({ filter, accountId, limit: limit ? Number(limit) : undefined })
	}

	/** Журнал событий: баны, разлогины, обращения по спам-блоку. */
	@Get('accounts/:id/events')
	events(@Param('id') id: string) {
		return this.svc.events(id)
	}

	// ── прогрев ──────────────────────────────────────────────────────────────

	/**
	 * Календарь суток: заходы прогрева и отправки рассылки на одной сетке.
	 */
	@Get('calendar')
	calendar(@Query('date') date?: string) {
		return this.svc.dayCalendar(date)
	}

	/** Что означают темпы прогрева — числами. */
	@Get('pace')
	pace() {
		return this.svc.paceInfo()
	}

	@Post('start')
	start(@Body() body: { ids: string[]; days?: number; windowFrom?: number; windowTo?: number; pace?: any }) {
		return this.svc.startWarmup(
			body?.ids ?? [], body?.days ?? 7, body?.windowFrom ?? 9, body?.windowTo ?? 23, body?.pace ?? 'normal',
		)
	}

	@Post('stop')
	stop(@Body() body: { ids: string[] }) {
		return this.svc.stopWarmup(body?.ids ?? [])
	}

	/** Каталог действий прогрева с пометкой «включено». */
	@Get('actions')
	actions() {
		return this.svc.actionsCatalog()
	}

	@Put('actions')
	setActions(@Body() body: { disabled: string[] }) {
		return this.svc.setDisabledActions(body?.disabled ?? [])
	}

	@Get('channels')
	async channels() {
		return { channels: await this.svc.getChannels() }
	}

	/**
	 * Пара приложения. Хеш наружу отдаём в замаскированном виде: увидеть, что он
	 * задан, нужно, а показывать его целиком в интерфейсе незачем.
	 */
	@Get('settings')
	async settings() {
		const { apiId, apiHash } = await this.svc.getApiDefaults()
		return { apiId, apiHashSet: !!apiHash, apiHashHint: apiHash ? `····${apiHash.slice(-4)}` : null }
	}

	@Put('settings')
	setSettings(@Body() body: { apiId: number | string; apiHash: string }) {
		return this.svc.setApiDefaults(body?.apiId, body?.apiHash)
	}

	@Put('channels')
	setChannels(@Body() body: { text: string }) {
		return this.svc.setChannels(body?.text ?? '')
	}
}
