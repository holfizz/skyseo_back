import { Module } from '@nestjs/common'
import { ManagerModule } from '../manager/manager.module'
import { PrismaModule } from '../prisma/prisma.module'
import { CrmService } from './crm.service'
import { FollowUpModule } from './follow-up.module'
import { WorkspaceCrmController } from './workspace-crm.controller'
import { TelegramModule } from '../telegram/telegram.module'
import { SalesReminderScheduler } from './sales-reminder.scheduler'

@Module({
	imports: [PrismaModule, ManagerModule, FollowUpModule, TelegramModule.forRoot()],
	controllers: [WorkspaceCrmController],
	providers: [CrmService, SalesReminderScheduler],
})
export class CrmModule {}
