import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { AdminGuard } from '../admin/admin.guard'
import { CurrentUser } from '../common/decorators/user.decorator'
import { OutreachStatus } from '@prisma/client'
import { OutreachImportService, SerpImportPayload, SerpImportRow } from './outreach-import.service'
import { OutreachService } from './outreach.service'

// Аутрич по выдаче Яндекса: приём прогона парсера и работа с лидом.
// Список лидов и воронка остались на /outreach (outreach.controller.ts).
@Controller('admin/outreach')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminOutreachController {
	constructor(
		private imports: OutreachImportService,
		private outreach: OutreachService,
	) {}

	// Приём import.json из yandex-leads: строки топ-50 + контакты по доменам.
	@Post('import')
	importRun(@Body() body: SerpImportPayload | SerpImportRow[], @CurrentUser() user: any) {
		return this.imports.importRun(body, user?.email)
	}

	@Get('imports')
	listImports() {
		return this.imports.listImports()
	}

	// Пересобрать тексты у всех лидов по текущему шаблону. Нужно после правки
	// формулировок: на импорте текст записывается один раз и сам не обновляется.
	@Post('rebuild-messages')
	rebuildMessages() {
		return this.outreach.rebuildMessages()
	}

	@Get(':id/message')
	getMessage(@Param('id') id: string) {
		return this.outreach.getMessage(id)
	}

	@Patch(':id')
	update(
		@Param('id') id: string,
		@Body()
		body: {
			firstName?: string | null
			lastName?: string | null
			middleName?: string | null
			companyName?: string | null
			city?: string | null
			phone?: string | null
			whatsapp?: string | null
			telegram?: string | null
			email?: string | null
			contact?: string | null
			inn?: string | null
			status?: OutreachStatus
			notes?: string | null
		},
	) {
		return this.outreach.updateLead(id, body)
	}
}
