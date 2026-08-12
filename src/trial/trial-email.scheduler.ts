import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { NotificationsService } from '../notifications/notifications.service'
import { PrismaService } from '../prisma/prisma.service'

/**
 * Письмо-дожим в момент окончания бесплатной недели. Шлётся ОДИН раз за всё время —
 * маркер users.trialEndEmailSentAt, по образцу winbackEmailSentAt.
 *
 * Отдельный модуль, а не часть CRM: CRM выключается флагом CRM_ENABLED, а письмо
 * должно уходить в любом случае.
 */
@Injectable()
export class TrialEmailScheduler implements OnModuleInit {
	private readonly logger = new Logger(TrialEmailScheduler.name)
	private running = false

	constructor(
		private prisma: PrismaService,
		private notifications: NotificationsService,
	) {}

	onModuleInit() {
		setTimeout(() => this.tick(), 45_000)
		setInterval(() => this.tick(), 60 * 60 * 1000).unref()
	}

	private async tick() {
		if (this.running) return
		this.running = true
		try {
			const now = new Date()
			// Триал закончился, ни одной оплаты не было, письмо ещё не уходило.
			const users = await this.prisma.user.findMany({
				where: {
					trialStartedAt: { not: null },
					trialEndEmailSentAt: null,
					paidUntil: { lt: now },
					payments: { none: { status: 'SUCCEEDED' } },
				},
				select: { id: true, email: true },
				take: 50,
			})
			if (users.length === 0) return

			for (const user of users) {
				// Атомарно занимаем отправку: апдейт пройдёт только пока маркер пуст.
				// Защищает от дубля при наложении тиков и в мульти-инстансе.
				const claimed = await this.prisma.user.updateMany({
					where: { id: user.id, trialEndEmailSentAt: null },
					data: { trialEndEmailSentAt: new Date() },
				})
				if (claimed.count !== 1) continue

				try {
					await this.notifications.sendRawEmail(
						user.email,
						'Неделя тестового продвижения закончилась',
						TRIAL_END_TEXT,
					)
				} catch (e) {
					this.logger.warn(`Письмо об окончании триала не ушло (${user.email}): ${e}`)
				}
			}
		} catch (e) {
			this.logger.error('trial email tick failed', e as Error)
		} finally {
			this.running = false
		}
	}
}

const TRIAL_END_TEXT = `Здравствуйте!

Неделя тестового продвижения закончилась.

Сразу честно: за неделю первый результат в поиске получить невозможно — позиции так быстро не двигаются. Но за это время видно другое, и это важнее:

1. Есть ли на вашем сайте визиты из поиска. Если есть — значит сайт находится по вашим ключам, и с ним можно работать дальше.
2. Какого они качества. Загляните в Яндекс.Метрику: глубина просмотра, время на сайте, отказы. Это показывает, насколько запросы вам подходят.

Если визитов не было — почти всегда причина одна: по этим ключам сайт пока не попадает в топ-50 Яндекса, а продвигать можно только то, что там уже есть. Это решается подбором других ключей, и мы с этим помогаем.

Хотите довести сайт до топ-10 — давайте обсудим. Ответьте на это письмо или напишите в Telegram: https://t.me/skyseo_support

Команда SkySEO
https://skyseo.site`
