import { Controller, Get, Query, UseGuards } from '@nestjs/common'
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
		} catch {
			return []
		}
	}
}
