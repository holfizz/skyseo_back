import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, UseGuards } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { AdminGuard } from '../admin/admin.guard'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { CurrentUser } from '../common/decorators/user.decorator'
import { OutreachImportService, type SerpImportPayload } from '../outreach/outreach-import.service'

type Job = { status: 'running' | 'done' | 'error'; startedAt: number; result?: unknown; error?: string }

/**
 * Загрузка import.json парсера выдачи (yandex-leads) из вкладки «База клиентов».
 *
 * Старая ручка admin/outreach/import закрыта вместе со старым продуктом, а лиды
 * для рассылки до сих пор приходят из парсера. Импорт долгий (частотность по
 * всем запросам, сотни лидов), и обычный запрос обрывается по таймауту прокси,
 * поэтому работа идёт в фоне: сервер сразу отвечает номером задачи, страница
 * спрашивает её состояние. Задачи живут в памяти: перезапуск сервера их сбросит,
 * а повторная загрузка того же файла безопасна (лиды ищутся по домену).
 */
@Controller('admin/tg-outreach')
@UseGuards(JwtAuthGuard, AdminGuard)
export class LeadImportController {
	private jobs = new Map<string, Job>()

	constructor(private imports: OutreachImportService) {}

	@Post('leads/import')
	start(@Body() body: SerpImportPayload, @CurrentUser() user: any) {
		if (!body || !Array.isArray(body.rows) || body.rows.length === 0) {
			throw new BadRequestException('В файле нет строк выдачи. Нужен import.json из парсера')
		}
		// Одна загрузка за раз: две параллельные дублировали бы запись и частотность.
		for (const j of this.jobs.values()) {
			if (j.status === 'running') throw new BadRequestException('Загрузка уже идёт, дождитесь её окончания')
		}
		const id = randomUUID()
		const job: Job = { status: 'running', startedAt: Date.now() }
		this.jobs.set(id, job)
		// Старые задачи не копим.
		if (this.jobs.size > 20) this.jobs.delete(this.jobs.keys().next().value as string)

		this.imports.importRun(body, user?.email)
			.then(result => { job.status = 'done'; job.result = result })
			.catch(e => { job.status = 'error'; job.error = String(e?.message ?? e).slice(0, 300) })
		return { id }
	}

	@Get('leads/import/:id')
	state(@Param('id') id: string) {
		const job = this.jobs.get(id)
		if (!job) throw new NotFoundException('Задача не найдена: возможно, сервер перезапускался. Загрузите файл снова')
		return { status: job.status, seconds: Math.round((Date.now() - job.startedAt) / 1000), result: job.result, error: job.error }
	}
}
