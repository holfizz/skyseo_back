import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { AdminModule } from './admin/admin.module'
import { AuthModule } from './auth/auth.module'
import { ExecutionsModule } from './executions/executions.module'
import { HealthModule } from './health/health.module'
import { NotificationsModule } from './notifications/notifications.module'
import { PaymentsModule } from './payments/payments.module'
import { PrismaModule } from './prisma/prisma.module'
import { StatisticsModule } from './statistics/statistics.module'
import { TasksModule } from './tasks/tasks.module'
import { TelegramModule } from './telegram/telegram.module'
import { UpdatesModule } from './updates/updates.module'
import { UsersModule } from './users/users.module'
import { WebsitesModule } from './websites/websites.module'

@Module({
	imports: [
		ConfigModule.forRoot({
			isGlobal: true,
		}),
		PrismaModule,
		HealthModule,
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
		UpdatesModule,
	],
})
export class AppModule {}
