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

	// Публичный — кабинет показывает расценки в тултипе баланса.
	@Get('points')
	async points() {
		return this.appConfig.getPointsConfig()
	}

	// Публичный — desktop-app тянет глубину перелистывания выдачи по дням.
	@Get('serp-pages')
	async serpPages() {
		const [r, nav, load] = await Promise.all([
			this.appConfig.getSerpPageRamp(),
			this.appConfig.getSerpNavConfig(),
			this.appConfig.getLoadConfig(),
		])
		return {
			ramp: r.ramp,
			final: r.final,
			next: {
				yandex: { css: nav.yandex.css.value, text: nav.yandex.text.value },
				google: { css: nav.google.css.value, text: nav.google.text.value },
			},
			parse: {
				yandexItem: nav.parse.yandexItem.value,
				yandexTitle: nav.parse.yandexTitle.value,
				googleRoot: nav.parse.googleRoot.value,
				googleLinks: nav.parse.googleLinks.value,
			},
			load: { ...load.current, dailyRamp: load.dailyRamp },
		}
	}

	// Публичный — форма создания сайта показывает «максимум сети» и считает пакет.
	@Get('network-capacity')
	async networkCapacity() {
		return this.appConfig.getNetworkCapacityInfo()
	}
}
