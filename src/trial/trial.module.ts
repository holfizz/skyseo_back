import { Module } from '@nestjs/common'
import { NotificationsModule } from '../notifications/notifications.module'
import { PrismaModule } from '../prisma/prisma.module'
import { TrialEmailScheduler } from './trial-email.scheduler'

@Module({
	imports: [PrismaModule, NotificationsModule],
	providers: [TrialEmailScheduler],
})
export class TrialModule {}
