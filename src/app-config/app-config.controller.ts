import { Controller, Get } from '@nestjs/common'
import { AppConfigService } from './app-config.service'

@Controller('config')
export class AppConfigController {
	constructor(private appConfig: AppConfigService) {}

	// Публичный — desktop-app тянет куки для обхода окна согласия Google.
	@Get('google')
	async google() {
		return this.appConfig.getGoogleConfig()
	}
}
