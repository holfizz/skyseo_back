import { Module } from '@nestjs/common'
import { AppConfigModule } from '../app-config/app-config.module'
import { ReportService } from './report.service'

// Публичного маршрута здесь нет: ссылка на отчёт живёт в outreach (/r/:token).
// AppConfigModule — ради цены «от N ₽», которая правится в админке.
@Module({
	imports: [AppConfigModule],
	providers: [ReportService],
	exports: [ReportService],
})
export class ReportModule {}
