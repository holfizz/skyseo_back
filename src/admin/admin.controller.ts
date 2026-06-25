import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { AnalyticsService } from '../analytics/analytics.service'
import { MetrikaService } from '../metrika/metrika.service'
import { AdminGuard } from './admin.guard'
import { AdminService } from './admin.service'

@Controller('admin')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminController {
	constructor(
		private adminService: AdminService,
		private analyticsService: AnalyticsService,
		private metrikaService: MetrikaService,
	) {}

	@Get('statistics')
	async getStatistics() {
		return this.adminService.getAdminStatistics()
	}

	// Куки Google (обход окна согласия) — читаются desktop-app'ом из БД
	@Get('google-config')
	async getGoogleConfig() {
		return this.adminService.getGoogleConfigForAdmin()
	}

	@Put('google-config')
	async setGoogleConfig(@Body() body: { socs?: string; consent?: string }) {
		return this.adminService.setGoogleConfig(body)
	}

	@Get('settings/points')
	async getPointsConfig() {
		return this.adminService.getPointsConfig()
	}

	@Put('settings/points')
	async setPointsConfig(@Body() body: { foundEarned?: number; foundSpent?: number; notFoundEarned?: number; notFoundSpent?: number }) {
		return this.adminService.setPointsConfig(body)
	}

	@Get('settings/network')
	async getNetworkConfig() {
		return this.adminService.getNetworkConfig()
	}

	@Put('settings/network')
	async setNetworkConfig(@Body() body: { activePcs?: number | null }) {
		return this.adminService.setNetworkConfig(body)
	}

	@Put('websites/:id')
	async updateWebsite(@Param('id') id: string, @Body() body: { dailyVisitsTarget?: number | null; autoMaxVisits?: boolean }) {
		return this.adminService.updateWebsite(id, body)
	}

	@Get('websites/pending')
	async getPendingWebsites() {
		return this.adminService.getPendingWebsites()
	}

	@Post('websites/:id/approve')
	async approveWebsite(@Param('id') id: string) {
		return this.adminService.approveWebsite(id)
	}

	@Post('websites/:id/reject')
	async rejectWebsite(@Param('id') id: string) {
		return this.adminService.rejectWebsite(id)
	}

	@Get('analytics')
	async getAnalytics(
		@Query('from') from?: string,
		@Query('to') to?: string,
	) {
		const toDate = to ? new Date(to + 'T23:59:59.999Z') : new Date()
		const fromDate = from ? new Date(from + 'T00:00:00.000Z') : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
		return this.adminService.getAnalytics(fromDate, toDate)
	}

	@Get('users')
	async getAllUsers(
		@Query('search') search?: string,
		@Query('offset') offset?: string,
		@Query('limit') limit?: string,
		@Query('sortBy') sortBy?: string,
		@Query('sortDir') sortDir?: string,
	) {
		return this.adminService.getAllUsers(
			search ?? '',
			offset ? Number(offset) : 0,
			limit ? Number(limit) : 100,
			sortBy ?? 'createdAt',
			(sortDir === 'asc' ? 'asc' : 'desc'),
		)
	}

	@Get('sites')
	async getAllSites(
		@Query('search') search?: string,
		@Query('offset') offset?: string,
		@Query('limit') limit?: string,
		@Query('sortBy') sortBy?: string,
		@Query('sortDir') sortDir?: string,
	) {
		return this.adminService.getAllSites(
			search ?? '',
			offset ? Number(offset) : 0,
			limit ? Number(limit) : 100,
			sortBy ?? 'createdAt',
			(sortDir === 'asc' ? 'asc' : 'desc'),
		)
	}

	@Get('users/:id')
	async getUser(@Param('id') id: string) {
		return this.adminService.getUserDetails(id)
	}

	@Put('users/:id/balance')
	async adjustBalance(
		@Param('id') id: string,
		@Body() body: { amount: number; description: string },
	) {
		return this.adminService.adjustUserBalance(
			id,
			body.amount,
			body.description,
		)
	}

	@Put('users/:id/toggle-active')
	async toggleUserActive(@Param('id') id: string) {
		return this.adminService.toggleUserActive(id)
	}

	@Put('users/:id/boost')
	async setUserBoost(@Param('id') id: string, @Body() body: { boost: number }) {
		return this.adminService.setUserBoost(id, body.boost)
	}

	@Get('tasks')
	async getAllTasks() {
		return this.adminService.getAllTasks()
	}

	@Get('executions')
	async getAllExecutions() {
		return this.adminService.getAllExecutions()
	}

	@Get('payments')
	async getAllPayments() {
		return this.adminService.getAllPayments()
	}

	@Get('active-users')
	async getActiveUsers() {
		return this.adminService.getActiveUsersNow()
	}

	@Get('inactive-users')
	async getInactiveUsers(@Query('days') days?: string) {
		return this.adminService.getInactiveUsers(days ? Number(days) : 7)
	}

	// Кто удалил приложение + длительность онлайна
	@Get('deleted-users')
	async getDeletedUsers() {
		return this.adminService.getDeletedUsers()
	}

	// Журнал задач (найденные + не найденные + ошибки со всей сети)
	@Get('execution-log')
	async getExecutionLog(@Query('limit') limit?: string) {
		return this.adminService.getExecutionLog(limit ? Number(limit) : 300)
	}

	// Письмо «вернись» — только по ручному нажатию админа
	@Post('users/:id/winback-email')
	async sendWinbackEmail(
		@Param('id') id: string,
		@Body() body: { subject: string; message: string },
	) {
		return this.adminService.sendWinbackEmail(id, body.subject, body.message)
	}

	@Get('promo-codes/:code/users')
	async getPromoCodeUsers(
		@Param('code') code: string,
		@Query('inactiveDays') inactiveDays?: string,
		@Query('appStatus') appStatus?: string, // фильтр (enum AppStatus): 'NEVER' | 'ACTIVE' | 'UNINSTALLED' | 'REINSTALLED'
	) {
		return this.adminService.getPromoCodeUsers(
			code,
			inactiveDays ? Number(inactiveDays) : undefined,
			appStatus,
		)
	}

	@Get('promo-codes-stats')
	async getPromoCodesStats() {
		return this.adminService.getPromoCodesStats()
	}

	// ─── CRUD промокодов ───
	@Get('promo-codes')
	async listPromoCodes() {
		return this.adminService.listPromoCodes()
	}

	@Post('promo-codes')
	async createPromoCode(@Body() body: { code: string; bonusPoints: number; description?: string; isActive?: boolean; budgetAmount?: number | null }) {
		return this.adminService.createPromoCode(body)
	}

	@Put('promo-codes/:id')
	async updatePromoCode(
		@Param('id') id: string,
		@Body() body: { code?: string; bonusPoints?: number; description?: string | null; isActive?: boolean; budgetAmount?: number | null; budgetMode?: string },
	) {
		return this.adminService.updatePromoCode(id, body)
	}

	@Delete('promo-codes/:id')
	async deletePromoCode(@Param('id') id: string) {
		return this.adminService.deletePromoCode(id)
	}

	@Get('site-stats')
	async getSiteStats(@Query('page') page?: string, @Query('limit') limit?: string) {
		return this.adminService.getSiteStats(page ? Number(page) : 0, limit ? Number(limit) : 30)
	}

	@Get('site-trend')
	async getSiteTrend(@Query('taskId') taskId: string) {
		return this.adminService.getSiteTrend(taskId)
	}

	@Get('conversion-funnel')
	async getConversionFunnel() {
		return this.adminService.getConversionFunnel()
	}

	// ─── CRUD воронки ───
	@Get('funnel-entries')
	async listFunnelEntries(@Query('limit') limit?: string) {
		return this.adminService.listFunnelEntries(limit ? Number(limit) : 200)
	}

	@Get('funnel-channels')
	async listFunnelChannels() {
		return this.adminService.listFunnelChannels()
	}

	@Post('funnel-entries')
	async createFunnelEntry(@Body() body: {
		date: string
		channel: string
		views?: number
		cost?: number
		registrations?: number
		purchases?: number
		revenue?: number
		note?: string
	}) {
		return this.adminService.createFunnelEntry(body)
	}

	@Put('funnel-entries/:id')
	async updateFunnelEntry(
		@Param('id') id: string,
		@Body() body: {
			date?: string
			channel?: string
			views?: number
			cost?: number
			registrations?: number
			purchases?: number
			revenue?: number
			note?: string | null
		},
	) {
		return this.adminService.updateFunnelEntry(id, body)
	}

	@Delete('funnel-entries/:id')
	async deleteFunnelEntry(@Param('id') id: string) {
		return this.adminService.deleteFunnelEntry(id)
	}

	// ─── Яндекс РСЯ кампании ───
	@Get('yandex-campaigns')
	async listYandexCampaigns() {
		return this.adminService.listYandexCampaigns()
	}

	@Post('yandex-campaigns')
	async createYandexCampaign(@Body() body: any) {
		return this.adminService.createYandexCampaign(body)
	}

	@Put('yandex-campaigns/:id')
	async updateYandexCampaign(@Param('id') id: string, @Body() body: any) {
		return this.adminService.updateYandexCampaign(id, body)
	}

	@Delete('yandex-campaigns/:id')
	async deleteYandexCampaign(@Param('id') id: string) {
		return this.adminService.deleteYandexCampaign(id)
	}

	@Post('yandex-campaigns/:id/keywords')
	async addYandexKeyword(@Param('id') id: string, @Body() body: any) {
		return this.adminService.addYandexKeyword(id, body)
	}

	@Put('yandex-keywords/:id')
	async updateYandexKeyword(@Param('id') id: string, @Body() body: any) {
		return this.adminService.updateYandexKeyword(id, body)
	}

	@Delete('yandex-keywords/:id')
	async deleteYandexKeyword(@Param('id') id: string) {
		return this.adminService.deleteYandexKeyword(id)
	}

	// ─── Telegram каналы ───
	@Get('telegram-channels')
	async listTelegramChannels() {
		return this.adminService.listTelegramChannels()
	}

	@Post('telegram-channels')
	async createTelegramChannel(@Body() body: any) {
		return this.adminService.createTelegramChannel(body)
	}

	@Get('telegram-channels/:id')
	async getTelegramChannel(@Param('id') id: string) {
		return this.adminService.getTelegramChannel(id)
	}

	@Put('telegram-channels/:id')
	async updateTelegramChannel(@Param('id') id: string, @Body() body: any) {
		return this.adminService.updateTelegramChannel(id, body)
	}

	@Delete('telegram-channels/:id')
	async deleteTelegramChannel(@Param('id') id: string) {
		return this.adminService.deleteTelegramChannel(id)
	}

	@Delete('users/:id')
	async deleteUser(@Param('id') id: string) {
		return this.adminService.deleteUser(id)
	}

	@Delete('users/:id/websites/:websiteId')
	async deleteWebsite(@Param('websiteId') websiteId: string) {
		return this.adminService.deleteWebsite(websiteId)
	}

	@Delete('tasks/:id')
	async deleteTask(@Param('id') id: string) {
		return this.adminService.deleteAdminTask(id)
	}

	@Get('funnel')
	async getFunnel(
		@Query('from') from?: string,
		@Query('to') to?: string,
	) {
		const toDate = to ? new Date(to + 'T23:59:59.999Z') : new Date()
		const fromDate = from ? new Date(from + 'T00:00:00.000Z') : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
		return this.analyticsService.getFunnelStats(fromDate, toDate)
	}

	@Get('metrika')
	async getMetrika() {
		return {
			configured: this.metrikaService.isConfigured(),
			authUrl: this.metrikaService.getAuthUrl(),
			stats: await this.metrikaService.getStats(),
		}
	}

	@Post('metrika/exchange')
	async exchangeMetrikaCode(@Body() body: { code: string }) {
		const token = await this.metrikaService.exchangeCode(body.code)
		return { token, message: 'Сохраните токен в METRIKA_TOKEN в .env и перезапустите сервер' }
	}

	@Get('hourly-activity')
	async getHourlyActivity() {
		return this.adminService.getHourlyActivity()
	}

	@Get('debug/executor/:id')
	async debugExecutor(@Param('id') id: string) {
		return this.adminService.debugExecutorAvailability(id)
	}

	@Post('websites/auto-max-visits')
	async enableAutoMaxVisitsAll() {
		return this.adminService.enableAutoMaxVisitsAll()
	}

	@Post('bulk-email')
	async startBulkEmail(@Body() body: { subject: string; message: string }) {
		return this.adminService.startBulkEmail(body.subject, body.message)
	}

	@Get('bulk-email/status')
	async getBulkEmailStatus() {
		return this.adminService.getBulkEmailStatus()
	}

}
