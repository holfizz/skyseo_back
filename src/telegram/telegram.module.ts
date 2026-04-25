import { DynamicModule, Module } from '@nestjs/common'
import { PrismaModule } from '../prisma/prisma.module'
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
			imports: [PrismaModule],
			controllers: [TelegramController],
			providers: [TelegramService],
			exports: [TelegramService],
		}
	}
}
