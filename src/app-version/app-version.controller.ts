import { Controller, Get, Query } from '@nestjs/common'
import { AppVersionService } from './app-version.service'

@Controller('app-version')
export class AppVersionController {
	constructor(private appVersionService: AppVersionService) {}

	@Get('check')
	async checkVersion(
		@Query('version') version: string,
		@Query('platform') platform: string,
	) {
		if (!version || !platform) {
			return {
				updateRequired: false,
				updateAvailable: false,
				error: 'Version and platform are required',
			}
		}

		return this.appVersionService.checkVersion(version, platform)
	}
}
