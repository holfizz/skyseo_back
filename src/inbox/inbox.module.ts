import { Module } from '@nestjs/common'
import { TelegramModule } from '../telegram/telegram.module'
import { InboxController } from './inbox.controller'
import { InboxService } from './inbox.service'

@Module({
	imports: [TelegramModule.forRoot()],
	controllers: [InboxController],
	providers: [InboxService],
})
export class InboxModule {}
