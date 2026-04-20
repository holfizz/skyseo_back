import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { TelegrafModule } from 'nestjs-telegraf'
import { TelegramController } from './telegram.controller'
import { TelegramService } from './telegram.service'

@Module({
	imports: [
		TelegrafModule.forRootAsync({
			imports: [ConfigModule],
			useFactory: (configService: ConfigService) => ({
				token: configService.get<string>('TELEGRAM_BOT_TOKEN') || 'dummy-token',
				launchOptions: {
					webhook: undefined, // Отключаем webhook, используем только для отправки
				},
			}),
			inject: [ConfigService],
		}),
	],
	controllers: [TelegramController],
	providers: [TelegramService],
	exports: [TelegramService],
})
export class TelegramModule {}
