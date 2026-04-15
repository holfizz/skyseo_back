import { Module, forwardRef } from '@nestjs/common'
import { NotificationsModule } from '../notifications/notifications.module'
import { UsersController } from './users.controller'
import { UsersService } from './users.service'

@Module({
	imports: [forwardRef(() => NotificationsModule)],
	providers: [UsersService],
	controllers: [UsersController],
	exports: [UsersService],
})
export class UsersModule {}
