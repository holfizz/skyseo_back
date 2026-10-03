import { Module } from '@nestjs/common'
import { MulterModule } from '@nestjs/platform-express'
import { NotificationsModule } from '../notifications/notifications.module'
import { ReportModule } from '../report/report.module'
import { AdminOutreachController } from './admin-outreach.controller'
import { OutreachController } from './outreach.controller'
import { OutreachImportService } from './outreach-import.service'
import { OutreachService } from './outreach.service'
import { ReportController } from './report.controller'
import { SiteLeadController } from './site-lead.controller'
import { SiteLeadService } from './site-lead.service'

@Module({
	imports: [MulterModule.register({ limits: { fileSize: 20 * 1024 * 1024 } }), NotificationsModule, ReportModule],
	controllers: [OutreachController, AdminOutreachController, ReportController, SiteLeadController],
	providers: [OutreachService, OutreachImportService, SiteLeadService],
	exports: [OutreachService, OutreachImportService], // менеджеру: тексты сообщений; вкладке «База клиентов»: загрузка import.json
})
export class OutreachModule {}
