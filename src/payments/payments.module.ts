import { Module } from '@nestjs/common'
import { AlertsModule } from '../alerts/alerts.module'
import { NotificationsModule } from '../notifications/notifications.module'
import { TelegramModule } from '../telegram/telegram.module'
import { UsersModule } from '../users/users.module'
import { PaymentsController } from './payments.controller'
import { PaymentsService } from './payments.service'

@Module({
	imports: [UsersModule, TelegramModule.forRoot(), NotificationsModule, AlertsModule],
	providers: [PaymentsService],
	controllers: [PaymentsController],
	exports: [PaymentsService],
})
export class PaymentsModule {}
