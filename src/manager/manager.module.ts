import { Module } from '@nestjs/common'
import { TelegramModule } from '../telegram/telegram.module'
import { ManagerController } from './manager.controller'
import { ManagerService } from './manager.service'

@Module({
	imports: [TelegramModule.forRoot()],
	controllers: [ManagerController],
	providers: [ManagerService],
	exports: [ManagerService],
})
export class ManagerModule {}
