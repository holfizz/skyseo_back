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
	private proxyRunning = false
	private spamRunning = false
	private upkeepRunning = false

	constructor(private svc: TgWarmupService) {}

	onModuleInit() {
		setTimeout(() => this.tick(), 60_000)
		// unref, чтобы таймер не удерживал процесс при остановке контейнера.
		setInterval(() => this.tick(), 60_000).unref()

		// Прокси залипают в «не отвечает», хотя живы (отвечают не с первой
		// попытки). Раз в несколько минут перепроверяем мёртвые — реально живые
		// оживают сами, без ручного пинга в кабинете.
		setTimeout(() => this.recheckProxies(), 120_000)
		setInterval(() => this.recheckProxies(), 4 * 60_000).unref()

		// Через сутки после PEER_FLOOD сами пишем @SpamBot и снимаем спам-лимит,
		// по итогу шлём уведомление. Раз в полчаса проверяем, кому пора.
		setTimeout(() => this.autoSpam(), 180_000)
		setInterval(() => this.autoSpam(), 30 * 60_000).unref()

		// Фон: у готового аккаунта всегда должен быть бессрочный прогон, иначе
		// между рассылками он не делает ничего. Раз в час — чаще незачем, фон
		// всё равно живёт сутками.
		setTimeout(() => this.upkeep(), 240_000)
		setInterval(() => this.upkeep(), 60 * 60_000).unref()
	}

	private async upkeep() {
		if (this.upkeepRunning) return
		this.upkeepRunning = true
		try {
			const started = await this.svc.ensureUpkeep()
			if (started) this.logger.log(`Заведён фон для аккаунтов: ${started}`)
		} catch (e: any) {
			this.logger.error(`Заведение фона упало: ${e?.message ?? e}`)
		} finally {
			this.upkeepRunning = false
		}
	}

	private async autoSpam() {
		if (this.spamRunning) return
		this.spamRunning = true
		try {
			const res = await this.svc.autoSpamAppeals()
			if (res.tried) this.logger.log(`Автоснятие спама: снято ${res.cleared} из ${res.tried}`)
			// Плановая проверка статуса: без неё поле «спам-блок» стоит тем,
			// чем его оставила последняя ручная проверка, а от него зависят и
			// оценка, и дневная норма.
			const routine = await this.svc.routineSpamChecks()
			if (routine.checked) this.logger.log(`Плановая проверка @SpamBot: ${routine.checked}`)
		} catch (e: any) {
			this.logger.error(`Автоснятие спама упало: ${e?.message ?? e}`)
		} finally {
			this.spamRunning = false
		}
	}

	private async recheckProxies() {
		if (this.proxyRunning) return
		this.proxyRunning = true
		try {
			const res = await this.svc.recheckDeadProxies()
			if (res.revived) this.logger.log(`Прокси оживлены: ${res.revived} из ${res.checked}`)
		} catch (e: any) {
			this.logger.error(`Перепроверка прокси упала: ${e?.message ?? e}`)
		} finally {
			this.proxyRunning = false
		}
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
