import { Controller, Get, Param, Request, UseGuards } from '@nestjs/common'
import { AdminGuard } from '../admin/admin.guard'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { StatisticsService } from './statistics.service'

@Controller('statistics')
@UseGuards(JwtAuthGuard)
export class StatisticsController {
	constructor(private statisticsService: StatisticsService) {}

	@Get('user')
	async getUserStatistics(@Request() req) {
		return this.statisticsService.getUserStatistics(req.user.id)
	}

	@Get('website/:id')
	async getWebsiteStatistics(@Request() req, @Param('id') websiteId: string) {
		return this.statisticsService.getWebsiteStatistics(websiteId, req.user.id)
	}

	@Get('website/:id/seo')
	async getWebsiteSeoStats(@Request() req, @Param('id') websiteId: string) {
		return this.statisticsService.getWebsiteSeoStats(websiteId, req.user.id)
	}

	// Раньше роль проверялась вручную и отдавала 500 вместо 403 — чужие попытки выглядели
	// в логах как краш сервера. Теперь тот же гвард, что и во всей админке.
	@Get('admin')
	@UseGuards(AdminGuard)
	async getAdminStatistics() {
		return this.statisticsService.getAdminStatistics()
	}
}
