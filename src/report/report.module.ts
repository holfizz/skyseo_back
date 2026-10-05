import { Module } from '@nestjs/common'
import { ReportService } from './report.service'

// Публичный маршрут презентации живёт в outreach (/r/:token).
@Module({
	providers: [ReportService],
	exports: [ReportService],
})
export class ReportModule {}
