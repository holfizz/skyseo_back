import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../prisma/prisma.service'
import { TelegramService } from '../telegram/telegram.service'

function esc(value: string) {
	return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** CRM-only reminders use the existing admin bot; Telegram-origin follow-ups stay with outreach. */
@Injectable()
export class SalesReminderScheduler implements OnModuleInit {
	private readonly logger = new Logger(SalesReminderScheduler.name)
	private running = false

	constructor(
		private readonly prisma: PrismaService,
		private readonly telegram: TelegramService,
		private readonly config: ConfigService,
	) {}

	onModuleInit() {
		if (this.config.get('NODE_ENV') !== 'production') return
		if (!this.config.get('TELEGRAM_ADMIN_ID') || !this.config.get('TELEGRAM_BOT_TOKEN')) return
		setTimeout(() => void this.tick(), 15_000).unref()
		setInterval(() => void this.tick(), 60_000).unref()
	}

	private async tick() {
		if (this.running) return
		this.running = true
		try {
			const due = await this.prisma.crmReminder.findMany({
				where: {
					sent: false, remindAt: { lte: new Date() },
					task: { followUpRecipientId: null, status: { in: ['TODO', 'IN_PROGRESS'] } },
				},
				include: { task: { select: { id: true, title: true, kind: true, dueAt: true, leadId: true } } },
				orderBy: { remindAt: 'asc' }, take: 20,
			})
			for (const reminder of due) {
				const claimedAt = new Date()
				const claim = await this.prisma.crmReminder.updateMany({
					where: { id: reminder.id, sent: false }, data: { sent: true, sentAt: claimedAt },
				})
				if (claim.count !== 1) continue
				const task = reminder.task
				const date = task.dueAt?.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }) || 'сейчас'
				const url = task.leadId ? `https://skyseo.site/holfizz/crm?lead=${encodeURIComponent(task.leadId)}` : 'https://skyseo.site/holfizz/crm'
				try {
					await this.telegram.sendOutreachNotification(
						`⏰ <b>${task.kind === 'CALL' ? 'Созвон' : 'Задача CRM'}</b> · ${esc(date)} МСК\n` +
						`${esc(task.title)}\n<a href="${url}">Открыть в CRM</a>`,
					)
				} catch (error) {
					// Delivery after a timeout is unknown. Keep the claim to avoid duplicate alerts;
					// the task remains visible in Today until a manager closes it.
					this.logger.warn(`CRM reminder ${reminder.id}: delivery uncertain: ${(error as Error).message}`)
				}
			}
		} catch (error) {
			this.logger.error('CRM reminders failed', error as Error)
		} finally { this.running = false }
	}
}
