import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { CampaignService } from './campaign.service'

/**
 * Два независимых тика рассылки.
 *
 * Отправщик и опросник разведены намеренно: отправка упирается в паузы между
 * сообщениями и может простаивать минутами, а ответы владелец просил видеть
 * каждую минуту. Общий тик означал бы, что уведомление о разговоре ждёт, пока
 * отстоится очередь отправки.
 */
@Injectable()
export class CampaignScheduler implements OnModuleInit {
	private readonly logger = new Logger(CampaignScheduler.name)
	private sending = false
	private polling = false

	constructor(private svc: CampaignService) {}

	onModuleInit() {
		// Со сдвигом друг от друга, чтобы два тика не лезли в сеть одновременно.
		setTimeout(() => this.send(), 70_000)
		setTimeout(() => this.poll(), 100_000)
		setInterval(() => this.send(), 60_000).unref()
		setInterval(() => this.poll(), 60_000).unref()
	}

	private async send() {
		if (this.sending) return
		this.sending = true
		try {
			const n = await this.svc.sendTick()
			if (n) this.logger.log(`Отправлено сообщений: ${n}`)
		} catch (e: any) {
			this.logger.error(`Тик отправки упал: ${e?.message ?? e}`)
		} finally {
			this.sending = false
		}
	}

	private async poll() {
		if (this.polling) return
		this.polling = true
		try {
			const r = await this.svc.pollTick()
			if (r.changed) this.logger.log(`Изменений в переписках: ${r.changed}, новых ответов: ${r.replies}`)
		} catch (e: any) {
			this.logger.error(`Тик опроса упал: ${e?.message ?? e}`)
		} finally {
			this.polling = false
		}
	}
}
