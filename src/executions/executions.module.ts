import { Module } from '@nestjs/common'
import { AppConfigModule } from '../app-config/app-config.module'
import { TelegramModule } from '../telegram/telegram.module'
import { UsersModule } from '../users/users.module'
import { ExecutionsController } from './executions.controller'
import { ExecutionsService } from './executions.service'

@Module({
	imports: [UsersModule, TelegramModule.forRoot(), AppConfigModule],
	providers: [ExecutionsService],
	controllers: [ExecutionsController],
	exports: [ExecutionsService],
})
export class ExecutionsModule {}
