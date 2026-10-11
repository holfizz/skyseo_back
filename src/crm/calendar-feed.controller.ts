import { Controller, Get, Param, Res } from '@nestjs/common'
import type { Response } from 'express'
import { CrmService } from './crm.service'

/** Bearer-token calendar subscription. Never log or expose the URL in other APIs. */
@Controller('workspace/crm/calendar-ics')
export class CalendarFeedController {
	constructor(private readonly crm: CrmService) {}

	@Get(':token')
	async feed(@Param('token') token: string, @Res() response: Response) {
		const ics = await this.crm.calendarFeed(token)
		response.set({
			'Content-Type': 'text/calendar; charset=utf-8',
			'Content-Disposition': 'inline; filename="skyseo-calls.ics"',
			'Cache-Control': 'private, max-age=300, must-revalidate',
			'Referrer-Policy': 'no-referrer',
			'X-Robots-Tag': 'noindex, nofollow',
		})
		response.send(ics)
	}
}
