import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { APP_GUARD } from '@nestjs/core'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import { AdminModule } from './admin/admin.module'
import { AppVersionModule } from './app-version/app-version.module'
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
		ThrottlerModule.forRoot([
			{ name: 'short', ttl: 1000, limit: 10 },
			{ name: 'medium', ttl: 60000, limit: 100 },
		]),
		PrismaModule,
		HealthModule,
		AuthModule,
		UsersModule,
		WebsitesModule,
		TasksModule,
		ExecutionsModule,
		StatisticsModule,
		PaymentsModule,
		TelegramModule.forRoot(),
		NotificationsModule,
		AdminModule,
		UpdatesModule,
		AppVersionModule,
	],
	providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
