import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { AdminModule } from './admin/admin.module'
import { AuthModule } from './auth/auth.module'
import { ExecutionsModule } from './executions/executions.module'
import { NotificationsModule } from './notifications/notifications.module'
import { PaymentsModule } from './payments/payments.module'
import { PrismaModule } from './prisma/prisma.module'
import { StatisticsModule } from './statistics/statistics.module'
import { TasksModule } from './tasks/tasks.module'
import { TelegramModule } from './telegram/telegram.module'
import { UsersModule } from './users/users.module'
import { WebsitesModule } from './websites/websites.module'

@Module({
	imports: [
		ConfigModule.forRoot({
			isGlobal: true,
		}),
		PrismaModule,
		AuthModule,
		UsersModule,
		WebsitesModule,
		TasksModule,
		ExecutionsModule,
		StatisticsModule,
		PaymentsModule,
		TelegramModule,
		NotificationsModule,
		AdminModule,
	],
})
export class AppModule {}
