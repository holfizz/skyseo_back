import { Module } from '@nestjs/common'
import { NotificationsModule } from '../notifications/notifications.module'
import { TelegramModule } from '../telegram/telegram.module'
import { UsersModule } from '../users/users.module'
import { PaymentsController } from './payments.controller'
import { PaymentsService } from './payments.service'

@Module({
	imports: [UsersModule, TelegramModule, NotificationsModule],
	providers: [PaymentsService],
	controllers: [PaymentsController],
	exports: [PaymentsService],
})
export class PaymentsModule {}
