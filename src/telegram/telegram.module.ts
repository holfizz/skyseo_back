import { DynamicModule, Module } from '@nestjs/common'
import { AlertsModule } from '../alerts/alerts.module'
import { AppConfigModule } from '../app-config/app-config.module'
import { PrismaModule } from '../prisma/prisma.module'
import { EngineHealthService } from './engine-health.service'
import { TelegramController } from './telegram.controller'
import { TelegramService } from './telegram.service'

@Module({})
export class TelegramModule {
	static forRoot(): DynamicModule {
		// Всегда возвращаем модуль БЕЗ Telegraf
		// TelegramService сам решит, инициализировать бота или нет
		console.log(
			'⚠️ Telegram module loaded (bot initialization deferred to service)',
		)

		return {
			module: TelegramModule,
			imports: [PrismaModule, AlertsModule, AppConfigModule],
			controllers: [TelegramController],
			providers: [TelegramService, EngineHealthService],
			exports: [TelegramService, EngineHealthService],
		}
	}
}
