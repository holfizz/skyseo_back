import {
	Body, Controller, Delete, Get, Param, Patch, Post, Query,
	UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { AdminGuard } from '../admin/admin.guard'
import { OutreachService } from './outreach.service'
import { OutreachStatus } from '@prisma/client'
import * as XLSX from 'xlsx'

@Controller('outreach')
@UseGuards(JwtAuthGuard, AdminGuard)
export class OutreachController {
	constructor(private svc: OutreachService) {}

	@Post('import')
	@UseInterceptors(FileInterceptor('file'))
	async importLeads(@UploadedFile() file: Express.Multer.File) {
		const wb = XLSX.read(file.buffer, { type: 'buffer' })
		const ws = wb.Sheets[wb.SheetNames[0]]
		const raw: any[] = XLSX.utils.sheet_to_json(ws, { defval: '' })
		// маппинг колонок из messages.xlsx
		const rows = raw.map(r => ({
			domain:   r['Домен']             || r['domain']   || '',
			contact:  r['Главный контакт']   || r['contact']  || '',
			channel:  r['Канал']             || r['channel']  || '',
			phone:    r['Все телефоны']      || r['phone']    || '',
			whatsapp: r['WhatsApp']          || r['whatsapp'] || '',
			telegram: r['Telegram']          || r['telegram'] || '',
			email:    r['Email']             || r['email']    || '',
			keywords: r['Подобранные запросы'] || r['keywords'] || '',
			message:  r['Сообщение']         || r['message']  || '',
		}))
		return this.svc.importLeads(rows)
	}

	@Get()
	getLeads(@Query('status') status?: OutreachStatus, @Query('search') search?: string) {
		return this.svc.getLeads(status, search)
	}

	@Get('stats')
	getStats() {
		return this.svc.getStats()
	}

	@Patch(':id/status')
	setStatus(@Param('id') id: string, @Body() body: { status: OutreachStatus; notes?: string }) {
		return this.svc.setStatus(id, body.status, body.notes)
	}

	@Post(':id/send-email')
	sendEmail(@Param('id') id: string, @Body() body: { text?: string }) {
		return this.svc.sendEmail(id, body?.text)
	}

	@Post(':id/tg-click')
	trackTg(@Param('id') id: string) {
		return this.svc.trackTgClick(id)
	}

	@Get('conversions')
	getConversions() {
		return this.svc.getConversions()
	}

	@Post('move-stale')
	moveStale() {
		return this.svc.moveStaleToDraft()
	}

	@Delete(':id')
	deleteLead(@Param('id') id: string) {
		return this.svc.deleteLead(id)
	}
}
