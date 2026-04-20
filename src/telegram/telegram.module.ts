import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { TelegrafModule } from 'nestjs-telegraf'
import { TelegramController } from './telegram.controller'
import { TelegramService } from './telegram.service'

@Module({
	imports: [
		TelegrafModule.forRootAsync({
			imports: [ConfigModule],
			useFactory: (configService: ConfigService) => {
				const token = configService.get<string>('TELEGRAM_BOT_TOKEN')

				// Если токена нет - используем dummy token и отключаем запуск
				if (!token || token === 'dummy-token') {
					return {
						token: 'dummy-token',
						launchOptions: false, // Полностью отключаем бота
					}
				}

				return {
					token,
					launchOptions: {
						webhook: undefined,
					},
				}
			},
			inject: [ConfigService],
		}),
	],
	controllers: [TelegramController],
	providers: [TelegramService],
	exports: [TelegramService],
})
export class TelegramModule {}
