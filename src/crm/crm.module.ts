import { Module } from '@nestjs/common'
import { ManagerModule } from '../manager/manager.module'
import { PrismaModule } from '../prisma/prisma.module'
import { CrmService } from './crm.service'
import { FollowUpModule } from './follow-up.module'
import { WorkspaceCrmController } from './workspace-crm.controller'
import { TelegramModule } from '../telegram/telegram.module'
import { SalesReminderScheduler } from './sales-reminder.scheduler'
import { QualificationService } from './qualification.service'
import { CalendarFeedController } from './calendar-feed.controller'
import { ReportModule } from '../report/report.module'
import { CallPreparationService } from './preparation/preparation.service'

@Module({
	imports: [PrismaModule, ManagerModule, FollowUpModule, TelegramModule.forRoot(), ReportModule],
	controllers: [WorkspaceCrmController, CalendarFeedController],
	providers: [CrmService, QualificationService, SalesReminderScheduler, CallPreparationService],
})
export class CrmModule {}
