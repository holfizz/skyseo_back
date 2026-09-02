import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { APP_GUARD } from '@nestjs/core'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import { AdminModule } from './admin/admin.module'
import { OutreachModule } from './outreach/outreach.module'
import { ManagerModule } from './manager/manager.module'
import { SprintModule } from './sprint/sprint.module'
import { TgWarmupModule } from './tg-warmup/tg-warmup.module'
import { InboxModule } from './inbox/inbox.module'
import { AiModule } from './ai/ai.module'
import { AnalyticsModule } from './analytics/analytics.module'
import { AppConfigModule } from './app-config/app-config.module'
import { AppVersionModule } from './app-version/app-version.module'
import { AuthModule } from './auth/auth.module'
import { CrmModule } from './crm/crm.module'
import { ExecutionsModule } from './executions/executions.module'
import { HealthModule } from './health/health.module'
import { AlertsModule } from './alerts/alerts.module'
import { NotifyBotModule } from './notify-bot/notify-bot.module'
import { NotificationsModule } from './notifications/notifications.module'
import { PaymentsModule } from './payments/payments.module'
import { PrismaModule } from './prisma/prisma.module'
import { RewardsModule } from './rewards/rewards.module'
import { SmmModule } from './smm/smm.module'
import { StatisticsModule } from './statistics/statistics.module'
import { TasksModule } from './tasks/tasks.module'
import { TelegramModule } from './telegram/telegram.module'
import { UpdatesModule } from './updates/updates.module'
import { UsersModule } from './users/users.module'
import { WebsitesModule } from './websites/websites.module'
import { TrialModule } from './trial/trial.module'

@Module({
	imports: [
		ConfigModule.forRoot({
			isGlobal: true,
		}),
		ThrottlerModule.forRoot([
			{ name: 'short', ttl: 1000, limit: 30 },
			{ name: 'medium', ttl: 60000, limit: 300 },
		]),
		PrismaModule,
		HealthModule,
		AuthModule,
		RewardsModule,
		UsersModule,
		WebsitesModule,
		TasksModule,
		ExecutionsModule,
		StatisticsModule,
		PaymentsModule,
		TelegramModule.forRoot(),
		NotificationsModule,
		NotifyBotModule,
		AlertsModule,
		AdminModule,
		SmmModule,
		ManagerModule,
		OutreachModule,
		SprintModule,
		TgWarmupModule,
		InboxModule,
		AnalyticsModule,
		UpdatesModule,
		AppVersionModule,
		AppConfigModule,
		AiModule,
		CrmModule,
		TrialModule,
	],
	providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
