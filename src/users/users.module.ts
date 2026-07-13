import { Module, forwardRef } from '@nestjs/common'
import { NotificationsModule } from '../notifications/notifications.module'
import { RewardsModule } from '../rewards/rewards.module'
import { WinbackModule } from '../winback/winback.module'
import { AppStatusCronService } from './app-status-cron.service'
import { UsersController } from './users.controller'
import { UsersService } from './users.service'

@Module({
	imports: [forwardRef(() => NotificationsModule), RewardsModule, WinbackModule],
	providers: [UsersService, AppStatusCronService],
	controllers: [UsersController],
	exports: [UsersService],
})
export class UsersModule {}
