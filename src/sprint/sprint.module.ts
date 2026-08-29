import { Module } from '@nestjs/common'
import { PrismaModule } from '../prisma/prisma.module'
import { OutreachModule } from '../outreach/outreach.module'
import { TelegramModule } from '../telegram/telegram.module'
import { SprintAdminController, SprintController } from './sprint.controller'
import { SprintService } from './sprint.service'

// План до зимы: спринты, дневная норма, очередь контактов, разбор недели.
@Module({
	imports: [PrismaModule, OutreachModule, TelegramModule.forRoot()],
	controllers: [SprintController, SprintAdminController],
	providers: [SprintService],
})
export class SprintModule {}
