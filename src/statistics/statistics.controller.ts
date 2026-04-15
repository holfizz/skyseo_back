import { Controller, Get, Param, Request, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { StatisticsService } from './statistics.service'

@Controller('statistics')
@UseGuards(JwtAuthGuard)
export class StatisticsController {
	constructor(private statisticsService: StatisticsService) {}

	@Get('website/:id')
	async getWebsiteStatistics(@Request() req, @Param('id') websiteId: string) {
		return this.statisticsService.getWebsiteStatistics(websiteId, req.user.id)
	}

	@Get('admin')
	async getAdminStatistics(@Request() req) {
		if (req.user.role !== 'ADMIN') {
			throw new Error('Access denied')
		}
		return this.statisticsService.getAdminStatistics()
	}
}
