import { Module } from '@nestjs/common'
import { TelegramModule } from '../telegram/telegram.module'
import { WebsitesController } from './websites.controller'
import { WebsitesService } from './websites.service'

@Module({
	imports: [TelegramModule.forRoot()],
	providers: [WebsitesService],
	controllers: [WebsitesController],
	exports: [WebsitesService],
})
export class WebsitesModule {}
