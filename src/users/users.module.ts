import { Module, forwardRef } from '@nestjs/common'
import { NotificationsModule } from '../notifications/notifications.module'
import { AppStatusCronService } from './app-status-cron.service'
import { UsersController } from './users.controller'
import { UsersService } from './users.service'

@Module({
	imports: [forwardRef(() => NotificationsModule)],
	providers: [UsersService, AppStatusCronService],
	controllers: [UsersController],
	exports: [UsersService],
})
export class UsersModule {}
