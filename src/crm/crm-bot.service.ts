import { Injectable, OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Telegraf } from 'telegraf'
import { PrismaService } from '../prisma/prisma.service'

const escapeHtml = (s: string) =>
	String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * Отдельный Telegram-бот CRM (TELEGRAM_CRM_BOT_TOKEN). Открывает Mini App и шлёт
 * напоминания сотрудникам. Не путать с админским и с notify-ботом — разные токены.
 *
 * Polling (bot.launch) и глобальная кнопка-меню включаются ТОЛЬКО в проде: иначе
 * дев и прод на одном токене конфликтуют (getUpdates 409), а setChatMenuButton
 * из дева перезаписал бы прод-URL меню на localhost. sendMessage работает всегда.
 */
@Injectable()
export class CrmBotService implements OnModuleDestroy {
	private bot: Telegraf | null = null
	private isEnabled = false
	private botUsername = 'skyseo_crm_bot'

	constructor(
		private config: ConfigService,
		private prisma: PrismaService,
	) {
		if (this.config.get('CRM_ENABLED') === 'false') {
			console.log('⛔ CRM выключена (CRM_ENABLED=false) — бот не запускается')
			return
		}
		const token = this.config.get<string>('TELEGRAM_CRM_BOT_TOKEN')
		if (token && token !== 'dummy-token' && token.length >= 20) {
			this.init(token)
		} else {
			console.log('⚠️ CRM-bot disabled (нет TELEGRAM_CRM_BOT_TOKEN)')
		}
	}

	private async init(token: string) {
		const isProd = this.config.get('NODE_ENV') === 'production'
		const webAppUrl = this.config.get<string>('CRM_WEBAPP_URL') || 'https://crm.skyseo.site'
		try {
			this.bot = new Telegraf(token)

			this.bot.start(async ctx => {
				await ctx.reply('SkySEO CRM. Нажми кнопку, чтобы открыть кабинет 👇', {
					reply_markup: {
						inline_keyboard: [[{ text: '📋 Открыть CRM', web_app: { url: webAppUrl } }]],
					},
				})
			})

			// /trial — кто уже отвалился с триала и кому можно написать в личку.
			this.bot.command('trial', async ctx => {
				if (!(await this.resolveActor(ctx))) {
					await ctx.reply('Нет доступа')
					return
				}
				const users = await this.prisma.user.findMany({
					where: {
						trialStartedAt: { not: null },
						telegramUsername: { not: null },
						paidUntil: { lt: new Date() },
					},
					select: { email: true, telegramUsername: true, paidUntil: true },
					orderBy: { paidUntil: 'desc' },
					take: 30,
				})
				if (users.length === 0) {
					await ctx.reply('Никого с законченным триалом и привязанным Telegram нет.')
					return
				}
				const lines = users.map(u => {
					const ended = u.paidUntil
						? new Date(u.paidUntil).toLocaleDateString('ru-RU')
						: '—'
					return `@${escapeHtml(u.telegramUsername ?? '')} · ${escapeHtml(u.email)} · до ${ended}`
				})
				await ctx.reply(
					`<b>Триал закончился — ${users.length}</b>\n\n${lines.join('\n')}`,
					{ parse_mode: 'HTML' },
				)
			})

			// Кнопки под карточкой дожима. Эталон — админский бот (telegram.service.ts):
			// answerCbQuery + editMessageReplyMarkup, чтобы кнопка перерисовалась и
			// повторное нажатие ничего не делало. Сознательно НЕ повторяем тамошний
			// антипаттерн с callback_data:'noop' — у него нет обработчика и спиннер висит.
			this.bot.on('callback_query', async ctx => {
				const actor = await this.resolveActor(ctx)
				if (!actor) {
					await ctx.answerCbQuery('Нет доступа')
					return
				}
				const data = (ctx.callbackQuery as any)?.data as string | undefined
				if (!data?.startsWith('trial_')) return

				const sent = data.startsWith('trial_sent_')
				const id = data.replace(sent ? 'trial_sent_' : 'trial_failed_', '')
				try {
					// Атомарно: исход проставляется только из состояния SENT_TO_MANAGER,
					// поэтому второе нажатие (в том числе с другого устройства) не пройдёт.
					const claim = await this.prisma.trialOutreach.updateMany({
						where: { id, status: 'SENT_TO_MANAGER' },
						data: {
							status: sent ? 'MESSAGE_SENT' : 'FAILED',
							handledBy: actor.id,
							handledAt: new Date(),
						},
					})
					if (claim.count !== 1) {
						await ctx.answerCbQuery('Уже отмечено')
						return
					}
					await ctx.answerCbQuery(sent ? '✅ Записал' : '⚠️ Записал как неудачу')
					await ctx.editMessageReplyMarkup({
						inline_keyboard: [[{ text: sent ? '✅ Отправлено' : '⚠️ Не получилось', callback_data: 'trial_done' }]],
					} as any)
					if (!sent) await this.notifyAdminsAboutFailure(id)
				} catch (e: any) {
					await ctx.answerCbQuery('Ошибка: ' + String(e?.message).slice(0, 60))
				}
			})

			// Заглушка для уже отмеченной карточки — чтобы спиннер не висел до таймаута.
			this.bot.action('trial_done', ctx => ctx.answerCbQuery('Уже отмечено'))

			const timeout = new Promise((_, reject) =>
				setTimeout(() => reject(new Error('Connection timeout')), 10000),
			)
			const info: any = await Promise.race([this.bot.telegram.getMe(), timeout])
			this.botUsername = info.username || this.botUsername
			this.isEnabled = true
			console.log(`✅ CRM-bot connected: @${this.botUsername}`)

			if (isProd) {
				// Глобальная кнопка-меню (открывает Mini App у всех) — только прод.
				await this.bot.telegram
					.setChatMenuButton({
						menuButton: { type: 'web_app', text: 'CRM', web_app: { url: webAppUrl } },
					} as any)
					.catch(() => {})
				this.bot.launch().catch(err =>
					console.error('[CrmBot] Polling error:', err.message),
				)
				console.log('[CrmBot] polling started')
			} else {
				console.log('[CrmBot] dev: polling/menu button отключены, доступна только отправка')
			}
		} catch (e: any) {
			console.log('⚠️ CRM-bot connection failed:', e.message)
			this.bot = null
			this.isEnabled = false
		}
	}

	/** Отправка сообщения участнику CRM по его telegramId. Тихо игнорирует ошибки. */
	async sendToUser(
		telegramId: string | null | undefined,
		text: string,
		button?: { text: string; url: string },
	): Promise<boolean> {
		if (!this.isEnabled || !this.bot || !telegramId) return false
		try {
			// web_app-кнопку Telegram принимает только с https-URL — в деве (localhost/http)
			// кнопку не вешаем, само напоминание всё равно уходит.
			const btn =
				button && /^https:\/\//.test(button.url)
					? {
							reply_markup: {
								inline_keyboard: [[{ text: button.text, web_app: { url: button.url } }]],
							},
						}
					: {}
			await this.bot.telegram.sendMessage(telegramId, text, {
				parse_mode: 'HTML',
				link_preview_options: { is_disabled: true },
				...btn,
			} as any)
			return true
		} catch (e: any) {
			console.log('[CrmBot] sendToUser failed:', e?.message)
			return false
		}
	}

	/**
	 * Отправка с произвольной inline-клавиатурой (кнопки с callback_data).
	 * Отдельный метод, а не расширение sendToUser: тот отдаёт web_app-кнопку
	 * и используется напоминаниями — менять его сигнатуру рискованно.
	 */
	async sendWithButtons(
		telegramId: string | null | undefined,
		text: string,
		keyboard: Array<Array<{ text: string; callback_data: string }>>,
	): Promise<boolean> {
		if (!this.isEnabled || !this.bot || !telegramId) return false
		try {
			await this.bot.telegram.sendMessage(telegramId, text, {
				parse_mode: 'HTML',
				link_preview_options: { is_disabled: true },
				reply_markup: { inline_keyboard: keyboard },
			} as any)
			return true
		} catch (e: any) {
			console.log('[CrmBot] sendWithButtons failed:', e?.message)
			return false
		}
	}

	/**
	 * Кто нажал. NestJS-гварды (CrmAuthGuard/CrmAdminGuard) на хендлеры Telegraf
	 * не действуют — это механика HTTP-пайплайна. Права проверяем руками по
	 * crm_users.telegramId, а не по TELEGRAM_ADMIN_ID: там другой бот и другой человек.
	 */
	private async resolveActor(ctx: any) {
		const tgId = String(ctx.from?.id ?? '')
		if (!tgId) return null
		const actor = await this.prisma.crmUser.findUnique({
			where: { telegramId: tgId },
			select: { id: true, isActive: true },
		})
		return actor?.isActive ? actor : null
	}

	/** «Написать не смогли» — зовём админов разбираться. */
	private async notifyAdminsAboutFailure(outreachId: string) {
		const row = await this.prisma.trialOutreach.findUnique({
			where: { id: outreachId },
			select: { email: true, telegram: true, websiteUrl: true },
		})
		if (!row) return
		const admins = await this.prisma.crmUser.findMany({
			where: { role: 'ADMIN', isActive: true, telegramId: { not: null } },
			select: { telegramId: true },
		})
		const text =
			`⚠️ <b>Не смогли написать по триалу</b>\n\n` +
			`Контакт: ${row.telegram ? '@' + escapeHtml(row.telegram) : '—'}\n` +
			`Почта: ${escapeHtml(row.email)}\n` +
			(row.websiteUrl ? `Сайт: ${escapeHtml(row.websiteUrl)}\n` : '') +
			`\nПроверь контакт руками.`
		for (const a of admins) await this.sendToUser(a.telegramId, text)
	}

	onModuleDestroy() {
		try {
			this.bot?.stop('SIGTERM')
		} catch {}
	}
}
