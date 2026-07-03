import { Module } from '@nestjs/common'
import { AlertsModule } from '../alerts/alerts.module'
import { AppConfigModule } from '../app-config/app-config.module'
import { TelegramModule } from '../telegram/telegram.module'
import { UsersModule } from '../users/users.module'
import { ExecutionsController } from './executions.controller'
import { ExecutionsService } from './executions.service'

@Module({
	imports: [UsersModule, TelegramModule.forRoot(), AppConfigModule, AlertsModule],
	providers: [ExecutionsService],
	controllers: [ExecutionsController],
	exports: [ExecutionsService],
})
export class ExecutionsModule {}
