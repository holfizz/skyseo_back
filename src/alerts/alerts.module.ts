import { Module } from '@nestjs/common'
import { NotificationsModule } from '../notifications/notifications.module'
import { NotifyBotModule } from '../notify-bot/notify-bot.module'
import { PrismaModule } from '../prisma/prisma.module'
import { AlertsService } from './alerts.service'

@Module({
	imports: [PrismaModule, NotificationsModule, NotifyBotModule],
	providers: [AlertsService],
	exports: [AlertsService],
})
export class AlertsModule {}
