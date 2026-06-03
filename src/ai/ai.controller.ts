import { BadRequestException, Body, Controller, Get, Post, Query, Request, UseGuards } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { AiService } from './ai.service'

@Controller('ai')
@UseGuards(JwtAuthGuard)
export class AiController {
	constructor(private aiService: AiService) {}

	@Post('analyze-site')
	analyzeSite(@Request() req, @Body('url') url: string, @Body('context') context?: string) {
		if (!url) throw new Error('url is required')
		return this.aiService.analyzeSite(url, context, req.user.id)
	}

	@Get('sitemap')
	getSitemap(@Query('url') url: string) {
		if (!url) throw new Error('url is required')
		return this.aiService.getSitemapUrls(url).then(pages => ({ pages }))
	}

	// Fallback для consent-окна Google (почищенный HTML модалки + список кликабельных элементов).
	// Жёсткий rate-limit на юзера: 5 вызовов/мин, 20/час — защита от промпт-инъекций и злоупотреблений.
	@Throttle({ short: { limit: 5, ttl: 60000 }, medium: { limit: 20, ttl: 3600000 } })
	@Post('resolve-consent')
	resolveConsent(
		@Body('html') html: string,
		@Body('candidates') candidates: { i: number; text: string }[],
	) {
		if (!html) return { isConsent: false, clickIndex: null }
		if (html.length > 10000) throw new BadRequestException('html too large')
		return this.aiService.resolveConsent(html, candidates ?? [])
	}
}
