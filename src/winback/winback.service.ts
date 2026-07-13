import { Injectable, Logger } from '@nestjs/common'
import { NotificationsService } from '../notifications/notifications.service'
import { PrismaService } from '../prisma/prisma.service'
import { TelegramService } from '../telegram/telegram.service'

const WINBACK_BONUS = 500

@Injectable()
export class WinbackService {
	private readonly logger = new Logger(WinbackService.name)

	constructor(
		private prisma: PrismaService,
		private notifications: NotificationsService,
		private telegram: TelegramService,
	) {}

	// Пришёл сигнал удаления (Windows-beacon или Mac-крон). Один раз за всё время
	// шлём письмо «вернитесь — дадим +500». Повторное удаление письмо не шлёт.
	async onUninstall(userId: string): Promise<void> {
		try {
			const user = await this.prisma.user.findUnique({
				where: { id: userId },
				select: { email: true, balance: true, winbackEmailSentAt: true },
			})
			if (!user || user.winbackEmailSentAt) return

			const subject = 'Вернитесь в SkySEO — и получите +500 баллов'
			const message = [
				`На вашем счёте в SkySEO осталось ${user.balance.toLocaleString('ru-RU')} баллов.`,
				'Мы заметили, что приложение больше не запущено. Верните его — и мы начислим вам +500 баллов в подарок за возвращение.',
				'Приложение работает само в фоне: ничего делать не нужно, баллы капают, пока оно просто включено.',
			].join('\n\n')

			await this.notifications.sendWinbackEmail(user.email, subject, message)
			// Флаг ставим ПОСЛЕ успешной отправки: если письмо упало — сможем отправить при следующем сигнале.
			await this.prisma.user.update({
				where: { id: userId },
				data: { winbackEmailSentAt: new Date() },
			})
			this.logger.log(`win-back письмо отправлено: ${user.email}`)
		} catch (e) {
			this.logger.error('onUninstall failed', e as Error)
		}
	}

	// Пользователь вернулся. Если ему слали письмо и бонус ещё не выдавали —
	// начисляем +500 (ровно один раз за всё время) и пингуем владельца в TG.
	async onReturn(userId: string): Promise<void> {
		try {
			const user = await this.prisma.user.findUnique({
				where: { id: userId },
				select: {
					email: true,
					balance: true,
					winbackEmailSentAt: true,
					winbackBonusGrantedAt: true,
				},
			})
			if (!user || !user.winbackEmailSentAt || user.winbackBonusGrantedAt) return

			// Атомарно «занимаем» бонус: апдейт пройдёт только если он ещё не выдан —
			// защита от двойного начисления при гонке (параллельные heartbeat'ы).
			const claimed = await this.prisma.user.updateMany({
				where: { id: userId, winbackBonusGrantedAt: null, winbackEmailSentAt: { not: null } },
				data: { balance: { increment: WINBACK_BONUS }, winbackBonusGrantedAt: new Date() },
			})
			if (claimed.count === 0) return

			await this.prisma.balanceHistory.create({
				data: {
					userId,
					amount: WINBACK_BONUS,
					type: 'WINBACK_BONUS',
					description: 'Бонус за возвращение в приложение',
				},
			})

			await this.telegram
				.sendAdminNotification(
					`🔁 <b>Вернулся после письма</b>\n${user.email}\n` +
						`Начислено +${WINBACK_BONUS} баллов (баланс был ${user.balance.toLocaleString('ru-RU')}).`,
				)
				.catch(() => {})

			this.logger.log(`win-back возврат: ${user.email} (+${WINBACK_BONUS})`)
		} catch (e) {
			this.logger.error('onReturn failed', e as Error)
		}
	}
}
