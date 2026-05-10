import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { AiService } from './ai.service'

@Controller('ai')
@UseGuards(JwtAuthGuard)
export class AiController {
	constructor(private aiService: AiService) {}

	@Post('analyze-site')
	analyzeSite(@Body('url') url: string, @Body('context') context?: string) {
		if (!url) throw new Error('url is required')
		return this.aiService.analyzeSite(url, context)
	}

	@Get('sitemap')
	getSitemap(@Query('url') url: string) {
		if (!url) throw new Error('url is required')
		return this.aiService.getSitemapUrls(url).then(pages => ({ pages }))
	}
}
