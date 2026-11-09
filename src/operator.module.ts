import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { APP_GUARD } from '@nestjs/core'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import { AdminModule } from './admin/admin.module'
import { AuthModule } from './auth/auth.module'
import { CrmModule } from './crm/crm.module'
import { HealthModule } from './health/health.module'
import { PrismaModule } from './prisma/prisma.module'
import { TgWarmupModule } from './tg-warmup/tg-warmup.module'
import { WorkspaceModule } from './workspace/workspace.module'

/** Internal CRM/outreach runtime; does not start the retired executor/payment/AI application. */
@Module({
	imports: [
		ConfigModule.forRoot({ isGlobal: true }),
		ThrottlerModule.forRoot([
			{ name: 'short', ttl: 1000, limit: 30 },
			{ name: 'medium', ttl: 60000, limit: 300 },
		]),
		PrismaModule, HealthModule, AuthModule, AdminModule,
		WorkspaceModule, TgWarmupModule, CrmModule,
	],
	providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class OperatorModule {}
