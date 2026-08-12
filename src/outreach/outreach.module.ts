import { Module } from '@nestjs/common'
import { MulterModule } from '@nestjs/platform-express'
import { NotificationsModule } from '../notifications/notifications.module'
import { ReportModule } from '../report/report.module'
import { AdminOutreachController } from './admin-outreach.controller'
import { OutreachController } from './outreach.controller'
import { OutreachImportService } from './outreach-import.service'
import { OutreachService } from './outreach.service'
import { ReportController } from './report.controller'

@Module({
	imports: [MulterModule.register({ limits: { fileSize: 20 * 1024 * 1024 } }), NotificationsModule, ReportModule],
	controllers: [OutreachController, AdminOutreachController, ReportController],
	providers: [OutreachService, OutreachImportService],
})
export class OutreachModule {}
