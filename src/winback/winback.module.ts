import { Module } from '@nestjs/common'
import { NotificationsModule } from '../notifications/notifications.module'
import { TelegramModule } from '../telegram/telegram.module'
import { WinbackService } from './winback.service'

@Module({
	imports: [NotificationsModule, TelegramModule.forRoot()],
	providers: [WinbackService],
	exports: [WinbackService],
})
export class WinbackModule {}
