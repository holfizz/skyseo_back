import { Module } from '@nestjs/common'
import { AppConfigModule } from '../app-config/app-config.module'
import { NotificationsModule } from '../notifications/notifications.module'
import { TelegramModule } from '../telegram/telegram.module'
import { UsersModule } from '../users/users.module'
import { TaskSchedulerService } from './task-scheduler.service'
import { TasksController } from './tasks.controller'
import { TasksService } from './tasks.service'

@Module({
	imports: [UsersModule, NotificationsModule, TelegramModule.forRoot(), AppConfigModule],
	providers: [TasksService, TaskSchedulerService],
	controllers: [TasksController],
	exports: [TasksService],
})
export class TasksModule {}
