import { Module } from '@nestjs/common'
import { WebsitesController } from './websites.controller'
import { WebsitesService } from './websites.service'

@Module({
	providers: [WebsitesService],
	controllers: [WebsitesController],
	exports: [WebsitesService],
})
export class WebsitesModule {}
