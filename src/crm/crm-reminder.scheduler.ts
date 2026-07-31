import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../prisma/prisma.service'
import { CrmBotService } from './crm-bot.service'

const escapeHtml = (s: string) =>
	String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * Раз в минуту берёт сработавшие (remindAt <= now) неотправленные напоминания и
 * шлёт их в CRM-бот целевому сотруднику. Помечает sent, чтобы не дублировать.
 */
@Injectable()
export class CrmReminderScheduler implements OnModuleInit {
	private readonly logger = new Logger(CrmReminderScheduler.name)
	private running = false // защита от наложения тиков в одной инстанции

	constructor(
		private prisma: PrismaService,
		private bot: CrmBotService,
		private config: ConfigService,
	) {}

	onModuleInit() {
		if (this.config.get('CRM_ENABLED') === 'false') return // CRM выключена
		setTimeout(() => this.tick(), 15_000)
		setInterval(() => this.tick(), 60_000).unref()
	}

	private async tick() {
		if (this.running) return // предыдущий тик ещё идёт — не накладываемся
		this.running = true
		try {
			const now = new Date()
			const dueRows = await this.prisma.crmReminder.findMany({
				where: { sent: false, remindAt: { lte: now } },
				select: { id: true },
				orderBy: { remindAt: 'asc' },
				take: 50,
			})
			if (dueRows.length === 0) return

			const webAppUrl =
				this.config.get<string>('CRM_WEBAPP_URL') || 'https://crm.skyseo.site'

			for (const { id } of dueRows) {
				// Атомарный захват: sent:false → sent:true одной операцией. Реально возьмёт
				// напоминание только один тик/инстанс (остальные получат count=0 и пропустят) —
				// исключает двойную отправку при наложении тиков и в мульти-инстансе.
				const claim = await this.prisma.crmReminder.updateMany({
					where: { id, sent: false },
					data: { sent: true, sentAt: new Date() },
				})
				if (claim.count !== 1) continue

				const r = await this.prisma.crmReminder.findUnique({
					where: { id },
					include: { task: { include: { client: true, assignee: true } }, target: true },
				})
				if (!r || r.task.status === 'DONE') continue // задача готова — не шлём

				const recipient = r.target ?? r.task.assignee
				if (!recipient?.telegramId) {
					this.logger.warn(`Напоминание ${r.id}: нет получателя, пропущено`)
					continue
				}
				const dueStr = r.task.dueAt
					? new Date(r.task.dueAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })
					: null
				const text =
					`⏰ <b>Напоминание</b>\n\n` +
					`📌 ${escapeHtml(r.task.title)}\n` +
					(r.task.client ? `👤 Клиент: ${escapeHtml(r.task.client.title)}\n` : '') +
					(dueStr ? `🕐 Срок: ${dueStr} (МСК)\n` : '') +
					(r.offsetLabel ? `\n${escapeHtml(r.offsetLabel)}` : '')
				const delivered = await this.bot.sendToUser(recipient.telegramId, text, {
					text: 'Открыть CRM',
					url: webAppUrl,
				})
				if (!delivered) this.logger.warn(`Напоминание ${r.id}: не доставлено (бот недоступен)`)
			}
		} catch (e) {
			this.logger.error('reminder tick failed', e as Error)
		} finally {
			this.running = false
		}
	}
}
