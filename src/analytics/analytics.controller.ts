import { Body, Controller, Post, Request } from '@nestjs/common'
import { AnalyticsService, TrackEventDto } from './analytics.service'

@Controller('analytics')
export class AnalyticsController {
	constructor(private analyticsService: AnalyticsService) {}

	@Post('track')
	async track(@Body() dto: TrackEventDto, @Request() req: any) {
		const ip =
			req.headers['x-real-ip'] ||
			req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
			req.ip
		return this.analyticsService.track(dto, ip)
	}
}
