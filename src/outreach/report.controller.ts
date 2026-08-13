import { Controller, Get, Param, Res } from '@nestjs/common'
import type { Response } from 'express'
import { ReportService } from '../report/report.service'
import { OutreachService } from './outreach.service'

// Публичная ссылка из письма/сообщения — без авторизации.
// Из-за глобального префикса реальный путь: /v1/api/r/:token.
// Токен и счётчик открытий держит OutreachService, вёрстку PDF — ReportService.
@Controller('r')
export class ReportController {
	constructor(
		private outreach: OutreachService,
		private report: ReportService,
	) {}

	@Get(':token')
	async open(@Param('token') token: string, @Res() res: Response) {
		// Открытие считаем до рендера: клик уже произошёл, даже если PDF не собрался.
		const lead = await this.outreach.registerReportOpen(token)
		const pdf = await this.report.renderPdf(lead.id)
		res.setHeader('Content-Type', 'application/pdf')
		res.setHeader('Content-Disposition', `inline; filename="${fileName(lead.domain)}"`)
		res.send(pdf)
	}

	// Та же ссылка, но браузер сохранит файл, а не откроет во вкладке.
	// Нужна для кнопки «скачать» в админке и когда лид просит «пришлите файлом».
	@Get(':token/download')
	async download(@Param('token') token: string, @Res() res: Response) {
		const lead = await this.outreach.registerReportOpen(token)
		const pdf = await this.report.renderPdf(lead.id)
		res.setHeader('Content-Type', 'application/pdf')
		res.setHeader('Content-Disposition', `attachment; filename="${fileName(lead.domain)}"`)
		res.send(pdf)
	}
}

// Имя файла в заголовке — только ASCII: кириллица и спецсимволы ломают
// Content-Disposition в части браузеров. Домены латинские, но точки и дефисы
// на всякий случай нормализуем.
function fileName(domain: string): string {
	const safe = domain.replace(/[^a-zA-Z0-9.-]/g, '_')
	return `skyseo-${safe}.pdf`
}
