import { Injectable } from '@nestjs/common'
import { NotificationsService } from '../notifications/notifications.service'
import { NotifyBotService } from '../notify-bot/notify-bot.service'
import { PrismaService } from '../prisma/prisma.service'

const CABINET_URL = 'https://skyseo.site/cabinet'

/**
 * Единая точка отправки пользовательских уведомлений: письмо на почту + сообщение
 * в Telegram-бот (если привязан). Все методы безопасны (ошибки глотаются) и не блокируют
 * основную бизнес-логику — вызывать без await либо с .catch(() => {}).
 */
@Injectable()
export class AlertsService {
	constructor(
		private prisma: PrismaService,
		private notifications: NotificationsService,
		private notifyBot: NotifyBotService,
	) {}

	private esc(s: string): string {
		return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
	}

	private async recipient(userId: string) {
		return this.prisma.user.findUnique({
			where: { id: userId },
			select: { email: true, telegramChatId: true },
		})
	}

	async paymentSucceeded(userId: string, amount: number, points: number) {
		const u = await this.recipient(userId)
		if (!u) return
		this.notifyBot
			.sendToChat(u.telegramChatId, `Баланс пополнен на ${points} баллов.`, {
				text: 'Открыть кабинет',
				url: CABINET_URL,
			})
			.catch(() => {})
	}

	async positionRose(
		userId: string,
		data: { keyword: string; siteName: string; oldPos: number; newPos: number },
	) {
		const u = await this.recipient(userId)
		if (!u) return
		this.notifications.sendPositionRiseEmail(u.email, data).catch(() => {})
		this.notifyBot
			.sendToChat(
				u.telegramChatId,
				`Сайт <b>${this.esc(data.siteName)}</b> поднялся в Яндексе по запросу «${this.esc(
					data.keyword,
				)}»: ${data.oldPos} → ${data.newPos}.`,
				{ text: 'Открыть кабинет', url: CABINET_URL },
			)
			.catch(() => {})
	}

	async lowBalance(userId: string, balance: number) {
		const u = await this.recipient(userId)
		if (!u) return
		this.notifications.sendLowBalanceEmail(u.email, balance).catch(() => {})
		this.notifyBot
			.sendToChat(
				u.telegramChatId,
				`На балансе меньше 300 баллов (${balance}). Пополните, чтобы продвижение не остановилось.`,
				{ text: 'Пополнить', url: CABINET_URL },
			)
			.catch(() => {})
	}

	async siteApproved(userId: string, siteName: string) {
		const u = await this.recipient(userId)
		if (!u) return
		this.notifications.sendSiteApprovedEmail(u.email, siteName).catch(() => {})
		this.notifyBot
			.sendToChat(
				u.telegramChatId,
				`Сайт <b>${this.esc(
					siteName,
				)}</b> одобрен. Продвижение запущено, первые результаты через 7–14 дней.`,
				{ text: 'Открыть кабинет', url: CABINET_URL },
			)
			.catch(() => {})
	}

	async siteRejected(userId: string, siteName: string) {
		const u = await this.recipient(userId)
		if (!u) return
		this.notifications.sendSiteRejectedEmail(u.email, siteName).catch(() => {})
		this.notifyBot
			.sendToChat(
				u.telegramChatId,
				`Сайт <b>${this.esc(siteName)}</b> не прошёл модерацию. Напишите в поддержку — подскажем, что поправить.`,
				{ text: 'Открыть кабинет', url: CABINET_URL },
			)
			.catch(() => {})
	}

	async abandonedPaymentOffer(
		userId: string,
		data: { points: number; amount: number; url: string },
	) {
		const u = await this.recipient(userId)
		if (!u) return
		this.notifications
			.sendAbandonedPaymentEmail(u.email, data)
			.catch(() => {})
		this.notifyBot
			.sendToChat(
				u.telegramChatId,
				`Скидка 10% на пополнение: те же ${data.points} баллов за ${data.amount} ₽.`,
				{ text: 'Оплатить со скидкой', url: data.url },
			)
			.catch(() => {})
	}
}
