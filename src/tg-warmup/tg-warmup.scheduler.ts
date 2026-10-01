import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { TgWarmupService } from './tg-warmup.service'

/** Только технические проверки. Фоновый прогрев и бессрочный UPKEEP отключены. */
@Injectable()
export class TgWarmupScheduler implements OnModuleInit {
 private readonly logger = new Logger(TgWarmupScheduler.name)
 private running = false
 private proxyRunning = false
 private spamRunning = false
 constructor(private svc: TgWarmupService) {}
 onModuleInit() {
  setTimeout(() => this.refreshEligible(), 60_000).unref()
  setInterval(() => this.refreshEligible(), 30 * 60_000).unref()
  setTimeout(() => this.recheckProxies(), 120_000).unref()
  setInterval(() => this.recheckProxies(), 4 * 60_000).unref()
  setTimeout(() => this.autoSpam(), 180_000).unref()
  setInterval(() => this.autoSpam(), 30 * 60_000).unref()
 }
 private async refreshEligible() {
  if (this.running) return
  this.running=true
  try { await this.svc.refreshEligibleAccounts() }
  catch(e:any) { this.logger.error(`Проверка Premium: ${e?.message ?? e}`) }
  finally { this.running=false }
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

}
