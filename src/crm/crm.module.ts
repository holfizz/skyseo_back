import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { ManagerModule } from '../manager/manager.module'
import { PrismaModule } from '../prisma/prisma.module'
import { CrmAdminGuard } from './crm-admin.guard'
import { CrmAuthGuard } from './crm-auth.guard'
import { CrmManageGuard } from './crm-manage.guard'
import { CrmAuthService } from './crm-auth.service'
import { CrmBotService } from './crm-bot.service'
import { CrmReminderScheduler } from './crm-reminder.scheduler'
import { CrmAuthController, CrmController } from './crm.controller'
import { CrmService } from './crm.service'

@Module({
	imports: [PrismaModule, ManagerModule, JwtModule.register({})],
	controllers: [CrmAuthController, CrmController],
	providers: [
		CrmAuthService,
		CrmService,
		CrmBotService,
		CrmReminderScheduler,
		CrmAuthGuard,
		CrmAdminGuard,
		CrmManageGuard,
	],
})
export class CrmModule {}
