import { Module } from '@nestjs/common'
import { ReportService } from './report.service'

// Публичного маршрута здесь нет: ссылка на отчёт живёт в outreach (/r/:token).
@Module({
	providers: [ReportService],
	exports: [ReportService],
})
export class ReportModule {}
