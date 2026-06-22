import { Module } from '@nestjs/common'
import { AnalyticsModule } from '../analytics/analytics.module'
import { AppConfigModule } from '../app-config/app-config.module'
import { MetrikaModule } from '../metrika/metrika.module'
import { NotificationsModule } from '../notifications/notifications.module'
import { TasksModule } from '../tasks/tasks.module'
import { TelegramModule } from '../telegram/telegram.module'
import { UsersModule } from '../users/users.module'
import { AdminController } from './admin.controller'
import { AdminService } from './admin.service'

@Module({
	imports: [UsersModule, AnalyticsModule, MetrikaModule, AppConfigModule, NotificationsModule, TasksModule, TelegramModule.forRoot()],
	controllers: [AdminController],
	providers: [AdminService],
})
export class AdminModule {}
