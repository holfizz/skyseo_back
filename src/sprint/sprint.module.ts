import { Module } from '@nestjs/common'
import { PrismaModule } from '../prisma/prisma.module'
import { OutreachModule } from '../outreach/outreach.module'
import { TelegramModule } from '../telegram/telegram.module'
import { ManagerModule } from '../manager/manager.module'
import { SprintAdminController, SprintController } from './sprint.controller'
import { SprintService } from './sprint.service'

// План до зимы: спринты, дневная норма, очередь контактов, разбор недели.
@Module({
	// ManagerModule — ради issuePayment: начисление баллов клиенту после оплаты на счёт.
	imports: [PrismaModule, OutreachModule, TelegramModule.forRoot(), ManagerModule],
	controllers: [SprintController, SprintAdminController],
	providers: [SprintService],
})
export class SprintModule {}
