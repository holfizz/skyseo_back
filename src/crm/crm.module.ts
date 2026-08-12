import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { AdminModule } from '../admin/admin.module'
import { ManagerModule } from '../manager/manager.module'
import { PrismaModule } from '../prisma/prisma.module'
import { CrmAdminGuard } from './crm-admin.guard'
import { CrmAuthGuard } from './crm-auth.guard'
import { CrmManageGuard } from './crm-manage.guard'
import { CrmAuthService } from './crm-auth.service'
import { CrmBotService } from './crm-bot.service'
import { CrmReminderScheduler } from './crm-reminder.scheduler'
import { CrmTrialScheduler } from './crm-trial.scheduler'
import { CrmAuthController, CrmController } from './crm.controller'
import { CrmService } from './crm.service'

@Module({
	imports: [PrismaModule, ManagerModule, AdminModule, JwtModule.register({})],
	controllers: [CrmAuthController, CrmController],
	providers: [
		CrmAuthService,
		CrmService,
		CrmBotService,
		CrmReminderScheduler,
		CrmTrialScheduler,
		CrmAuthGuard,
		CrmAdminGuard,
		CrmManageGuard,
	],
})
export class CrmModule {}
