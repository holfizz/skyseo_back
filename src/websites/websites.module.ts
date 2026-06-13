import { Module } from '@nestjs/common'
import { TelegramModule } from '../telegram/telegram.module'
import { AppConfigModule } from '../app-config/app-config.module'
import { WebsitesController } from './websites.controller'
import { WebsitesService } from './websites.service'

@Module({
	imports: [TelegramModule.forRoot(), AppConfigModule],
	providers: [WebsitesService],
	controllers: [WebsitesController],
	exports: [WebsitesService],
})
export class WebsitesModule {}
