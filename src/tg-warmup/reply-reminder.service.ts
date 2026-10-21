import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { TelegramService } from '../telegram/telegram.service'
import { senderLabel } from './sender-label'

const MINUTE = 60_000
export const REPLY_REMINDER_DELAYS = [30 * MINUTE, 90 * MINUTE] as const

type Incoming = { tgId: number; date: Date }

function esc(value: string | null | undefined): string {
	return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Reminds the operator only. Never opens a Telegram account or messages a lead. */
@Injectable()
export class ReplyReminderService implements OnModuleInit, OnModuleDestroy {
	private readonly logger = new Logger(ReplyReminderService.name)
	private timer?: ReturnType<typeof setInterval>
	private running = false

	constructor(private readonly prisma: PrismaService, private readonly telegram: TelegramService) {}

	onModuleInit() {
		this.timer = setInterval(() => {
			void this.tick().catch(() => this.logger.error('Не удалось проверить напоминания об ответах'))
		}, MINUTE)
		this.timer.unref()
	}

	onModuleDestroy() {
		if (this.timer) clearInterval(this.timer)
	}

	/** Called only for newly fetched incoming messages, not when reading the chat. */
	async trackIncoming(recipientId: string, incoming: Incoming[]) {
		if (!incoming.length) return
		const outgoing = await this.prisma.tgDialogMessage.findFirst({
			where: { recipientId, out: true, tgId: { gt: 0 } }, orderBy: { tgId: 'desc' }, select: { tgId: true },
		})
		const outId = outgoing?.tgId ?? 0
		const recipient = await this.prisma.tgRecipient.findUnique({ where: { id: recipientId }, select: { replyHandledThroughTgId: true, peerDeleted: true } })
		if (!recipient || recipient.peerDeleted) return
		const handledId = Math.max(outId, recipient.replyHandledThroughTgId)
		const first = incoming.filter(m => m.tgId > handledId).sort((a, b) => a.tgId - b.tgId)[0]
		if (!first) return
		const data = {
			anchorTgId: first.tgId, anchorAt: first.date, attempts: 0,
			nextAt: new Date(first.date.getTime() + REPLY_REMINDER_DELAYS[0]),
			lastAttemptAt: null, lastSentAt: null, lastError: null,
		}
		// The old anchor stays throughout a burst, even after both notifications.
		// Only a confirmed outgoing between the two anchors may start a new cycle.
		await this.prisma.tgReplyReminder.createMany({ data: [{ recipientId, ...data }], skipDuplicates: true })
		await this.prisma.tgReplyReminder.updateMany({
			where: { recipientId, anchorTgId: { lte: handledId } }, data,
		})
	}

	async tick(now = new Date()): Promise<number> {
		if (this.running) return 0
		this.running = true
		try {
			const due = await this.prisma.tgReplyReminder.findMany({
				where: { nextAt: { lte: now }, attempts: { lt: 2 } },
				orderBy: { nextAt: 'asc' }, take: 50,
			})
			let sent = 0
			for (const reminder of due) {
				const latest = await this.latestMessage(reminder.recipientId)
				if (!latest || latest.out || latest.tgId < reminder.anchorTgId || await this.hasAnswer(reminder.recipientId, reminder.anchorTgId)) {
					await this.cancel(reminder.recipientId, reminder.anchorTgId)
					continue
				}
				// After a long shutdown, send only the final overdue reminder, not two
				// notifications back to back. Claim durably before the external API:
				// ambiguous network failures must not replay the same notification.
				const attempt = now.getTime() >= reminder.anchorAt.getTime() + REPLY_REMINDER_DELAYS[1] ? 2 : 1
				const claimed = await this.prisma.tgReplyReminder.updateMany({
					where: { recipientId: reminder.recipientId, anchorTgId: reminder.anchorTgId,
						attempts: reminder.attempts, nextAt: { lte: now } },
					data: { attempts: attempt, lastAttemptAt: now, lastError: null,
						nextAt: attempt === 1 ? new Date(reminder.anchorAt.getTime() + REPLY_REMINDER_DELAYS[1]) : null },
				})
				if (!claimed.count) continue
				// A reply may have arrived while this worker was claiming the alert.
				const current = await this.latestMessage(reminder.recipientId)
				if (!current || current.out || await this.hasAnswer(reminder.recipientId, reminder.anchorTgId)) {
					await this.cancel(reminder.recipientId, reminder.anchorTgId)
					continue
				}
				const recipient = await this.prisma.tgRecipient.findUnique({
					where: { id: reminder.recipientId },
					select: { firstName: true, middleName: true, lastName: true, domain: true,
						account: { select: { label: true, firstName: true, lastName: true, username: true } } },
				})
				if (!recipient) continue
				const who = [recipient.firstName, recipient.middleName, recipient.lastName].filter(Boolean).join(' ') || 'Контакт'
				const wait = Math.floor((now.getTime() - reminder.anchorAt.getTime()) / MINUTE)
				try {
					await this.telegram.sendOutreachNotification(
						`⏳ <b>Вы не ответили клиенту</b>\n\n` +
						`<b>${esc(who)}</b>${recipient.domain ? ` · ${esc(recipient.domain)}` : ''}\n` +
						`С аккаунта: <b>${esc(senderLabel(recipient.account))}</b>\n` +
						`Без ответа: ${wait} мин. Напоминание ${attempt} из 2.\n\n` +
						`<blockquote>${esc(current.text.slice(0, 700))}</blockquote>\n` +
						`<a href="https://skyseo.site/holfizz/telegram?tab=inbox&amp;dialog=${encodeURIComponent(reminder.recipientId)}">Ответить в переписке</a>`,
					)
					sent++
					await this.prisma.tgReplyReminder.updateMany({
						where: { recipientId: reminder.recipientId, anchorTgId: reminder.anchorTgId, attempts: attempt },
						data: { lastSentAt: new Date() },
					})
				} catch {
					// Never log the Bot API URL/token or private message contents.
					this.logger.warn(`Напоминание ${attempt} не подтверждено, повтор исключен`)
					await this.prisma.tgReplyReminder.updateMany({
						where: { recipientId: reminder.recipientId, anchorTgId: reminder.anchorTgId, attempts: attempt },
						data: { lastError: 'Отправка уведомления не подтверждена' },
					})
				}
			}
			return sent
		} finally {
			this.running = false
		}
	}

	private latestMessage(recipientId: string) {
		return this.prisma.tgDialogMessage.findFirst({
			where: { recipientId, tgId: { gt: 0 } }, orderBy: { tgId: 'desc' },
			select: { tgId: true, out: true, text: true },
		})
	}

	private cancel(recipientId: string, anchorTgId: number) {
		return this.prisma.tgReplyReminder.updateMany({ where: { recipientId, anchorTgId }, data: { nextAt: null } })
	}

	private async hasAnswer(recipientId: string, anchorTgId: number) {
		const recipient = await this.prisma.tgRecipient.findUnique({ where: { id: recipientId }, select: { replyHandledThroughTgId: true, peerDeleted: true } })
		if (!recipient || recipient.peerDeleted || recipient.replyHandledThroughTgId >= anchorTgId) return true
		return Boolean(await this.prisma.tgDialogMessage.findFirst({
			where: { recipientId, out: true, tgId: { gt: anchorTgId } }, select: { id: true },
		}))
	}
}
