import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { TgWarmupService } from './tg-warmup.service'

/**
 * Ежеминутный тик прогрева.
 *
 * Почему setInterval, а не @nestjs/schedule с кроном. Во-первых, пакета в
 * проекте нет, и вся периодика здесь сделана именно так. Во-вторых, крон тут
 * и не подходит: момент запуска у каждого аккаунта свой и случайный внутри
 * окна активности, а расписание хранится в базе — планировщику остаётся раз в
 * минуту спрашивать «кому пора».
 *
 * Через минуту после старта, а не сразу: миграции и подключение к базе должны
 * успеть завершиться.
 */
@Injectable()
export class TgWarmupScheduler implements OnModuleInit {
	private readonly logger = new Logger(TgWarmupScheduler.name)
	private running = false

	constructor(private svc: TgWarmupService) {}

	onModuleInit() {
		setTimeout(() => this.tick(), 60_000)
		// unref, чтобы таймер не удерживал процесс при остановке контейнера.
		setInterval(() => this.tick(), 60_000).unref()
	}

	private async tick() {
		// Один заход может занять минуты: внутри реальные паузы между
		// действиями. Наложение тиков привело бы к двойной норме за день.
		if (this.running) return
		this.running = true
		try {
			const handled = await this.svc.tick()
			if (handled) this.logger.log(`Отработано прогонов: ${handled}`)
		} catch (e: any) {
			this.logger.error(`Тик прогрева упал: ${e?.message ?? e}`)
		} finally {
			this.running = false
		}
	}
}
