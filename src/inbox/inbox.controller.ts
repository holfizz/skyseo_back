import { Body, Controller, Get, HttpException, Param, Post, Query, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { AdminGuard } from '../admin/admin.guard'
import { InboxService } from './inbox.service'

@Controller('inbox')
@UseGuards(JwtAuthGuard, AdminGuard)
export class InboxController {
	constructor(private svc: InboxService) {}

	@Get()
	async fetch(@Query('limit') limit?: string) {
		try {
			return await this.svc.fetchInbox(limit ? Number(limit) : 50)
		} catch (e) {
			console.error('[Inbox] fetchInbox error:', e?.message)
			return []
		}
	}

	@Post(':uid/reply')
	async reply(@Param('uid') uid: string, @Body() body: { to: string; subject: string; text: string }) {
		try {
			await this.svc.replyToEmail(body.to, body.subject, body.text)
			return { ok: true }
		} catch (e) {
			throw new HttpException(e?.message || 'SMTP error', 400)
		}
	}
}
