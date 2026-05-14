import { Module } from '@nestjs/common'
import { TelegramModule } from '../telegram/telegram.module'
import { UsersModule } from '../users/users.module'
import { ExecutionsController } from './executions.controller'
import { ExecutionsService } from './executions.service'

@Module({
	imports: [UsersModule, TelegramModule.forRoot()],
	providers: [ExecutionsService],
	controllers: [ExecutionsController],
	exports: [ExecutionsService],
})
export class ExecutionsModule {}
