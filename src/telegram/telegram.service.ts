import { Injectable, OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Telegraf } from 'telegraf'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class TelegramService implements OnModuleDestroy {
	private bot: Telegraf | null = null
	private adminId: string
	private isEnabled: boolean = false
	private lastConsentAlertAt = 0 // дебаунс алерта о протухшей куке Google (in-memory)

	private readonly GROUP_CHAT_ID = '-1003723547668'
	private readonly TOPIC_REGISTRATIONS = 2
	private readonly TOPIC_WEBSITES = 4
	private readonly TOPIC_CAPTCHA = 7
	private readonly TOPIC_PAYMENTS = 9
	private readonly TOPIC_COMPLAINTS = 14

	constructor(
		private configService: ConfigService,
		private prisma: PrismaService,
	) {
		this.adminId = this.configService.get('TELEGRAM_ADMIN_ID')
		const token = this.configService.get('TELEGRAM_BOT_TOKEN')

		// Пытаемся инициализировать бота только если есть валидный токен
		if (token && token !== 'dummy-token' && token.length >= 20) {
			this.initializeBot(token)
		} else {
			console.log('⚠️ Telegram notifications disabled (no valid token)')
		}
	}

	private async initializeBot(token: string) {
		console.log('[TelegramService] Initializing bot...')
		try {
			// Инициализируем бота без прокси
			this.bot = new Telegraf(token)

			// Регистрируем команды
			this.setupCommands()

			// Пытаемся проверить подключение с таймаутом
			const timeoutPromise = new Promise((_, reject) =>
				setTimeout(() => reject(new Error('Connection timeout')), 10000),
			)

			console.log('[TelegramService] Testing bot connection...')
			const getMePromise = this.bot.telegram.getMe()

			const botInfo = await Promise.race([getMePromise, timeoutPromise])

			this.isEnabled = true
			console.log(
				`✅ Telegram bot connected successfully: @${(botInfo as any).username}`,
			)

			// Запускаем polling для приёма команд
			this.bot.launch().catch(err => {
				console.error('[TelegramService] Polling error:', err.message)
			})
			console.log('[TelegramService] Bot polling started')
		} catch (error) {
			console.log('⚠️ Telegram bot connection failed:', error.message)
			console.log('⚠️ Telegram notifications disabled')
			this.bot = null
			this.isEnabled = false
		}
	}

	// ─── Авторассылка ───────────────────────────────────────────────────────────
	// Состояние рассылки: один экземпляр в памяти (сервер не перезапускается между запусками)
	private spamRunning = false
	private spamAbort = false
	private spamIntervalMs = 10 * 60 * 1000 // дефолт 10 мин
	// Ожидающий ввод интервала (chatId → true)
	private spamAwaitingInterval = new Set<number | string>()

	// Случайный интервал: база * (1 ± jitter%), где jitter растёт с интервалом
	private randDelay(baseMs: number): number {
		// При 10 сек → ±10%, при 10 мин → ±10%, при 60 мин → ±15%, при 24ч → ±20%
		const jitterPct = Math.min(0.1 + (baseMs / (24 * 60 * 60 * 1000)) * 0.1, 0.25)
		const delta = baseMs * jitterPct
		return Math.round(baseMs - delta + Math.random() * 2 * delta)
	}

	private async runSpam(intervalMs: number) {
		this.spamRunning = true
		this.spamAbort = false
		this.spamIntervalMs = intervalMs

		const leads = await this.prisma.outreachLead.findMany({
			where: { status: 'NEW', email: { not: null } },
			orderBy: { createdAt: 'asc' },
		})

		let sent = 0
		let failed = 0
		const startedAt = Date.now()

		await this.sendAdminNotification(
			`📨 <b>Авторассылка запущена</b>\n` +
			`Лидов: <b>${leads.length}</b> · Интервал: ~${Math.round(intervalMs / 1000)} сек`,
		)

		for (const lead of leads) {
			if (this.spamAbort) break
			if (!lead.email) continue

			try {
				await this.prisma.outreachLead.update({
					where: { id: lead.id },
					data: {
						emailsSent: { increment: 1 },
						contactedAt: lead.contactedAt ?? new Date(),
						contactedVia: 'email',
						status: 'CONTACTED',
					},
				})
				// Импортируем NotificationsService через prisma — используем прямой HTTP к SMTP
				// (не можем инжектировать через setupCommands, вызываем через метод сервиса)
				await this.sendRawEmailViaNotifications(lead.email, lead.message)
				sent++
			} catch {
				failed++
			}

			if (this.spamAbort) break

			// Пауза перед следующей отправкой (кроме последней)
			if (leads.indexOf(lead) < leads.length - 1) {
				const delay = this.randDelay(intervalMs)
				await new Promise<void>(res => {
					const timer = setTimeout(res, delay)
					// Проверяем abort каждые 2 сек
					const check = setInterval(() => { if (this.spamAbort) { clearTimeout(timer); clearInterval(check); res() } }, 2000)
					void timer
					void check
				})
			}
		}

		this.spamRunning = false
		const elapsed = Math.round((Date.now() - startedAt) / 1000)
		const aborted = this.spamAbort ? ' (прервано)' : ''

		await this.sendAdminNotification(
			`✅ <b>Авторассылка завершена${aborted}</b>\n\n` +
			`📨 Отправлено: <b>${sent}</b>\n` +
			`❌ Ошибок: <b>${failed}</b>\n` +
			`⏱ Время: ${Math.floor(elapsed / 60)} мин ${elapsed % 60} сек`,
		)
	}

	// Вызывается через notifications.service — нужен доступ к нему. Получаем через lazy import.
	private notificationsService: any = null
	setNotificationsService(svc: any) { this.notificationsService = svc }

	private async sendRawEmailViaNotifications(email: string, text: string) {
		if (!this.notificationsService) throw new Error('NotificationsService not set')
		await this.notificationsService.sendRawEmail(email, 'SkySEO — поднимите сайт в топ Яндекса', text)
	}

	// ────────────────────────────────────────────────────────────────────────────

	private isAdmin(ctx: any): boolean {
		return String(ctx.from?.id) === String(this.adminId)
	}

	private setupCommands() {
		if (!this.bot) return

		// Команда /start
		this.bot.command('start', async ctx => {
			const extra = this.isAdmin(ctx) ? '\n/spam - Авторассылка по лидам' : ''
			await ctx.reply(
				'👋 Привет! Я бот SkySEO.\n\n' +
					'Доступные команды:\n' +
					'/stats - Общая статистика платформы\n' +
					'/daily - Статистика за сегодня' + extra,
			)
		})

		// Команда /stats - общая статистика
		this.bot.command('stats', async ctx => {
			try {
				const stats = await this.getComprehensiveStats()
				await ctx.reply(stats, { parse_mode: 'HTML' })
			} catch (error) {
				console.error('[TelegramService] Error getting stats:', error)
				await ctx.reply('❌ Ошибка при получении статистики')
			}
		})

		// Команда /daily - статистика за сегодня
		this.bot.command('daily', async ctx => {
			try {
				const stats = await this.getDailyStats()
				await ctx.reply(stats, { parse_mode: 'HTML' })
			} catch (error) {
				console.error('[TelegramService] Error getting daily stats:', error)
				await ctx.reply('❌ Ошибка при получении статистики')
			}
		})

		// Команда /spam — запуск / остановка авторассылки (только для админа)
		this.bot.command('spam', async ctx => {
			if (!this.isAdmin(ctx)) return

			if (this.spamRunning) {
				// Уже запущена — предложить остановить
				await ctx.reply(
					`📨 <b>Авторассылка уже идёт</b>\n` +
					`Интервал: ~${Math.round(this.spamIntervalMs / 1000)} сек\n\n` +
					`Остановить? Напиши /spamstop`,
					{ parse_mode: 'HTML' },
				)
				return
			}

			// Считаем сколько лидов будет отправлено
			const count = await this.prisma.outreachLead.count({
				where: { status: 'NEW', email: { not: null } },
			}).catch(() => 0)

			if (count === 0) {
				await ctx.reply('📭 Нет лидов со статусом NEW и email для рассылки.')
				return
			}

			this.spamAwaitingInterval.add(ctx.from!.id)
			await ctx.reply(
				`📨 <b>Авторассылка</b>\n\n` +
				`Будет отправлено: <b>${count}</b> писем\n\n` +
				`Укажи интервал между письмами в секундах:\n` +
				`(например: <code>600</code> = 10 минут, <code>30</code> = 30 секунд)\n\n` +
				`Интервал будет случайным ±10% от указанного.`,
				{ parse_mode: 'HTML' },
			)
		})

		// Команда /spamstop — остановка рассылки
		this.bot.command('spamstop', async ctx => {
			if (!this.isAdmin(ctx)) return
			if (!this.spamRunning) {
				await ctx.reply('ℹ️ Рассылка не запущена.')
				return
			}
			this.spamAbort = true
			await ctx.reply('⏹ Остановка рассылки... Дождись завершения текущего письма.')
		})

		// Обработка текстовых сообщений — ввод интервала после /spam
		this.bot.on('text', async ctx => {
			if (!this.isAdmin(ctx)) return
			const chatId = ctx.from?.id
			if (!chatId || !this.spamAwaitingInterval.has(chatId)) return

			const secs = parseInt(ctx.message.text.trim(), 10)
			if (isNaN(secs) || secs < 5) {
				await ctx.reply('❌ Неверный интервал. Введи число секунд (минимум 5).')
				return
			}

			this.spamAwaitingInterval.delete(chatId)
			const count = await this.prisma.outreachLead.count({
				where: { status: 'NEW', email: { not: null } },
			}).catch(() => 0)
			const estMin = Math.round((count * secs) / 60)

			await ctx.reply(
				`✅ <b>Подтверди запуск рассылки</b>\n\n` +
				`📬 Писем: <b>${count}</b>\n` +
				`⏱ Интервал: ~${secs} сек (±10%)\n` +
				`🕐 Примерное время: ~${estMin} мин\n\n` +
				`Запустить? Напиши <code>да</code> или <code>нет</code>`,
				{ parse_mode: 'HTML' },
			)

			// Сохраняем интервал и ждём подтверждения
			const pendingMs = secs * 1000
			const confirmHandler = async (msg: any) => {
				if (String(msg.from?.id) !== String(chatId)) return
				const text = msg.text?.toLowerCase().trim()
				if (text === 'да' || text === 'yes') {
					// Запускаем в фоне
					this.runSpam(pendingMs).catch(e => {
						this.spamRunning = false
						this.sendAdminNotification(`❌ <b>Рассылка упала с ошибкой:</b>\n${e?.message}`).catch(() => {})
					})
				} else {
					await ctx.reply('❌ Рассылка отменена.')
				}
			}

			// Одноразовый обработчик подтверждения (next message from same user)
			this.bot!.on('text', async ctx2 => {
				if (String(ctx2.from?.id) !== String(chatId)) return
				if (this.spamRunning || this.spamAwaitingInterval.has(chatId)) return
				await confirmHandler(ctx2.message)
			})
		})

		// Одобрение / отклонение сайтов через inline-кнопки
		this.bot.on('callback_query', async ctx => {
			if (!this.isAdmin(ctx)) {
				await ctx.answerCbQuery('Нет доступа')
				return
			}

			const data = (ctx.callbackQuery as any).data as string | undefined
			if (!data) return

			if (data.startsWith('approve_site_')) {
				const websiteId = data.replace('approve_site_', '')
				try {
					await this.prisma.website.update({
						where: { id: websiteId },
						data: { isApproved: true },
					})
					await ctx.answerCbQuery('✅ Одобрено')
					await ctx.editMessageReplyMarkup({ inline_keyboard: [[
						{ text: '✅ Одобрен', callback_data: 'noop' },
					]] })
				} catch (e) {
					await ctx.answerCbQuery('Ошибка: ' + e.message)
				}
				return
			}

			if (data.startsWith('reject_site_confirm_')) {
				const websiteId = data.replace('reject_site_confirm_', '')
				try {
					await this.prisma.$transaction([
						this.prisma.website.update({
							where: { id: websiteId },
							data: { isRestricted: true },
						}),
						this.prisma.task.updateMany({
							where: { websiteId, isActive: true },
							data: { keywordStatus: 'RESTRICTED' },
						}),
					])
					await ctx.answerCbQuery('❌ Отклонён')
					await ctx.editMessageReplyMarkup({ inline_keyboard: [[
						{ text: '❌ Отклонён', callback_data: 'noop' },
					]] })
				} catch (e) {
					await ctx.answerCbQuery('Ошибка: ' + e.message)
				}
				return
			}

			if (data.startsWith('reject_site_cancel_')) {
				await ctx.answerCbQuery('Отменено')
				await ctx.editMessageReplyMarkup({ inline_keyboard: [[
					{ text: '✅ Одобрить', callback_data: data.replace('reject_site_cancel_', 'approve_site_') },
					{ text: '❌ Отклонить', callback_data: data.replace('reject_site_cancel_', 'reject_site_') },
				]] })
				return
			}

			if (data.startsWith('reject_site_')) {
				const websiteId = data.replace('reject_site_', '')
				await ctx.answerCbQuery('Подтвердите отклонение')
				await ctx.editMessageReplyMarkup({ inline_keyboard: [[
					{ text: '🚫 Да, отклонить', callback_data: `reject_site_confirm_${websiteId}` },
					{ text: '↩️ Назад', callback_data: `reject_site_cancel_${websiteId}` },
				]] })
				return
			}
		})
	}

	onModuleDestroy() {
		this.bot?.stop()
	}

	async sendAdminNotification(message: string, threadId?: number) {
		if (!this.isEnabled || !this.bot) {
			console.log('[Telegram disabled]:', message)
			return
		}

		const targetId = threadId ? this.GROUP_CHAT_ID : this.adminId
		if (!targetId) {
			console.log('[Telegram] No target ID configured, skipping:', message)
			return
		}

		try {
			const extra: any = { parse_mode: 'HTML' }
			if (threadId) extra.message_thread_id = threadId
			const sendPromise = this.bot.telegram.sendMessage(targetId, message, extra)
			const timeoutPromise = new Promise((_, reject) =>
				setTimeout(() => reject(new Error('send timeout')), 5000),
			)
			await Promise.race([sendPromise, timeoutPromise])
		} catch (error) {
			console.error('[TelegramService] Failed to send notification:', error.message)
		}
	}

	async sendRegistrationNotification(
		email: string,
		city: string,
		source: string,
		ipAddress: string,
		balance: number,
		userType: string,
		promoCode?: string,
	) {
		const message =
			`🆕 <b>Новая регистрация</b>\n\n` +
			`📧 Email: ${email}\n` +
			`👤 Роль: ${userType}\n` +
			`🌍 Город: ${city || 'Не указан'}\n` +
			`📍 Источник: ${source || 'Не указан'}\n` +
			`🎟 Промокод: ${promoCode || 'Не указан'}\n` +
			`🌐 IP: ${ipAddress || 'Не определен'}\n` +
			`🕐 Время: ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}`

		await this.sendAdminNotification(message, this.TOPIC_REGISTRATIONS)
	}

	async sendPaymentNotification(email: string, amount: number, points: number) {
		const message =
			`💰 <b>Новый платеж</b>\n\n` +
			`👤 Email: ${email}\n` +
			`💵 Сумма: ${amount.toFixed(2)} ₽\n` +
			`⭐ Начислено баллов: ${points}\n` +
			`🕐 Время: ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}`

		await this.sendAdminNotification(message, this.TOPIC_PAYMENTS)
	}

	async sendRestrictedKeywordReport(data: {
		userEmail: string
		keyword: string
		websiteUrl: string
		message: string
		telegram?: string
	}) {
		const msg =
			`🔓 <b>Запрос на активацию ключевика</b>\n\n` +
			`👤 Аккаунт: ${data.userEmail}\n` +
			(data.telegram ? `📱 Телеграм: ${data.telegram}\n` : '') +
			`🌐 Сайт: ${data.websiteUrl}\n` +
			`🔑 Ключевик: <b>${data.keyword}</b>\n` +
			(data.message ? `\n💬 Сообщение: ${data.message}\n` : '') +
			`\n🕐 Время: ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}`

		await this.sendAdminNotification(msg, this.TOPIC_COMPLAINTS)
	}

	async sendRestrictedSiteReport(data: {
		userEmail: string
		websiteName: string
		websiteUrl: string
		message: string
		telegram?: string
	}) {
		const msg =
			`🔓 <b>Запрос на активацию сайта</b>\n\n` +
			`👤 Аккаунт: ${data.userEmail}\n` +
			(data.telegram ? `📱 Телеграм: ${data.telegram}\n` : '') +
			`🌐 Сайт: ${data.websiteName} (${data.websiteUrl})\n` +
			(data.message ? `\n💬 Сообщение: ${data.message}\n` : '') +
			`\n🕐 Время: ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}`

		await this.sendAdminNotification(msg, this.TOPIC_COMPLAINTS)
	}

	async sendAppInstallNotification(email: string, appVersion?: string) {
		const message =
			`📱 <b>Установка приложения</b>\n\n` +
			`👤 Email: ${email}\n` +
			`📦 Версия: ${appVersion || 'Не указана'}\n` +
			`🕐 Время: ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}`

		await this.sendAdminNotification(message)
	}

	private normalizeTelegramContact(raw?: string): string {
		if (!raw?.trim()) return 'не указан'
		let s = raw.trim()
		// https://t.me/username, http://t.me/username, t.me/username
		const urlMatch = s.match(/(?:https?:\/\/)?t\.me\/([A-Za-z0-9_]{3,})(?:\?.*)?$/)
		if (urlMatch) return `@${urlMatch[1]}`
		// @username или просто username (только TG-допустимые символы)
		s = s.replace(/^@+/, '')
		if (/^[A-Za-z0-9_]{3,}$/.test(s)) return `@${s}`
		// Всё остальное (email, телефон и т.д.) — оставить как есть
		return raw.trim()
	}

	async sendComplaintNotification(
		text: string,
		contact?: string,
		userEmail?: string,
	) {
		const tg = this.normalizeTelegramContact(contact)

		const message =
			`⚠️ <b>Новая жалоба</b>\n\n` +
			`📝 Текст: ${text || 'Не указан'}\n` +
			`📧 Email пользователя: ${userEmail || 'Не авторизован'}\n` +
			`✈️ Telegram: ${tg}`

		await this.sendAdminNotification(message, this.TOPIC_COMPLAINTS)
	}

	async sendCaptchaAlertNotification(data: {
		engine: string
		keyword: string
		websiteUrl: string
		userEmail: string
		browserProfile: { userAgent: string; screenWidth: number; screenHeight: number; webGLVendor: string; webGLRenderer: string }
		dailyQueryLog: Array<{ ts: string; engine: string; keyword: string; websiteUrl: string }>
	}) {
		const now = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })
		const historyLines = data.dailyQueryLog
			.map(e => `  ${e.ts} [${e.engine}] ${e.keyword} → ${e.websiteUrl}`)
			.join('\n') || '  (нет данных)'

		const message =
			`🚨 <b>КАПЧА — ${data.engine.toUpperCase()}</b>\n\n` +
			`🕐 Время: ${now} (МСК)\n` +
			`👤 Аккаунт: ${data.userEmail}\n\n` +
			`🔍 Запрос: <b>${data.keyword}</b>\n` +
			`🌐 Сайт: ${data.websiteUrl}\n\n` +
			`💻 Браузер:\n` +
			`  UA: ${data.browserProfile.userAgent}\n` +
			`  Экран: ${data.browserProfile.screenWidth}×${data.browserProfile.screenHeight}\n` +
			`  GPU: ${data.browserProfile.webGLVendor}\n\n` +
			`📋 Запросы за сегодня (${data.dailyQueryLog.length} шт):\n${historyLines}`

		await this.sendAdminNotification(message, this.TOPIC_CAPTCHA)
	}

	async sendWebsiteCreatedNotification(data: {
		websiteId: string
		userEmail: string
		websiteName: string
		websiteUrl: string
		similarSites?: { url: string; user: { email: string } }[]
	}) {
		if (!this.isEnabled || !this.bot) return

		let message =
			`🌐 <b>Новый сайт — требует одобрения</b>\n\n` +
			`👤 Аккаунт: ${data.userEmail}\n` +
			`📌 Название: ${data.websiteName}\n` +
			`🔗 Ссылка: ${data.websiteUrl}\n`

		if (data.similarSites && data.similarSites.length > 0) {
			message += `\n⚠️ <b>Похожие домены на площадке (${data.similarSites.length}):</b>\n`
			data.similarSites.forEach(s => {
				message += `• ${s.url} — ${s.user.email}\n`
			})
		}

		message += `\n🕐 Время: ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}`

		try {
			await this.bot.telegram.sendMessage(this.GROUP_CHAT_ID, message, {
				parse_mode: 'HTML',
				message_thread_id: this.TOPIC_WEBSITES,
				reply_markup: {
					inline_keyboard: [[
						{ text: '✅ Одобрить', callback_data: `approve_site_${data.websiteId}` },
						{ text: '❌ Отклонить', callback_data: `reject_site_${data.websiteId}` },
					]],
				},
			} as any)
		} catch (err) {
			console.error('[TelegramService] sendWebsiteCreatedNotification error:', err.message)
		}
	}

	async sendContactFormNotification(data: {
		name: string
		email: string
		phone?: string
		message: string
	}) {
		const message =
			`📬 <b>Новая заявка с сайта</b>\n\n` +
			`👤 Имя: ${data.name}\n` +
			`📧 Email: ${data.email}\n` +
			`📞 Телефон: ${data.phone || 'Не указан'}\n` +
			`💬 Сообщение: ${data.message}`

		await this.sendAdminNotification(message)
	}

	// Получение комплексной статистики
	private async getComprehensiveStats(): Promise<string> {
		const now = new Date()
		const startOfToday = new Date(
			now.getFullYear(),
			now.getMonth(),
			now.getDate(),
		)

		// Получаем все данные параллельно
		const [
			totalUsers,
			activeUsers,
			usersByVersion,
			usersByReferralSource,
			totalTasks,
			activeTasks,
			completedTasks,
			yandexTasks,
			googleTasks,
			totalExecutions,
			foundInTopCount,
			notFoundCount,
			activeExecutors,
			totalEarned,
			totalPayments,
			totalRevenue,
			paymentsToday,
			revenueTodayAgg,
		] = await Promise.all([
			// Всего пользователей
			this.prisma.user.count(),

			// Активные пользователи (выполняли задачи за последние 7 дней)
			this.prisma.execution
				.groupBy({
					by: ['executorId'],
					where: {
						createdAt: {
							gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
						},
					},
				})
				.then(result => result.length),

			// Пользователи по версиям приложения
			this.prisma.user.groupBy({
				by: ['appVersion'],
				_count: { appVersion: true },
				where: { appVersion: { not: null } },
				orderBy: { _count: { appVersion: 'desc' } },
			}),

			// Пользователи по источникам регистрации
			this.prisma.user.groupBy({
				by: ['referralSource'],
				_count: { referralSource: true },
				where: { referralSource: { not: null } },
				orderBy: { _count: { referralSource: 'desc' } },
			}),

			// Всего заданий создано
			this.prisma.task.count(),

			// Активных заданий
			this.prisma.task.count({ where: { isActive: true, status: 'PENDING' } }),

			// Выполненных заданий (executions)
			this.prisma.execution.count({ where: { status: 'COMPLETED' } }),

			// Задания с Яндексом
			this.prisma.task.count({ where: { useYandex: true, isActive: true } }),

			// Задания с Google
			this.prisma.task.count({ where: { useGoogle: true, isActive: true } }),

			// Всего выполнений
			this.prisma.execution.count(),

			// Успешных полных операций (сайт найден в топе, полный визит)
			this.prisma.execution.count({
				where: { status: 'COMPLETED', foundInTop: true },
			}),

			// Переходы без нахождения в топе (сайт не найден)
			this.prisma.execution.count({
				where: { status: 'COMPLETED', foundInTop: false },
			}),

			// Активных исполнителей (выполняли задачи)
			this.prisma.execution
				.groupBy({ by: ['executorId'], where: { status: 'COMPLETED' } })
				.then(result => result.length),

			// Всего заработано баллов пользователями
			this.prisma.balanceHistory.aggregate({
				_sum: { amount: true },
				where: { type: 'TASK_EARNED' },
			}),

			// Всего успешных платежей
			this.prisma.payment.count({ where: { status: 'SUCCEEDED' } }),

			// Общая сумма платежей
			this.prisma.payment.aggregate({
				_sum: { amount: true },
				where: { status: 'SUCCEEDED' },
			}),

			// Платежи за сегодня
			this.prisma.payment.count({ where: { status: 'SUCCEEDED', paidAt: { gte: startOfToday } } }),

			// Выручка за сегодня
			this.prisma.payment.aggregate({
				_sum: { amount: true },
				where: { status: 'SUCCEEDED', paidAt: { gte: startOfToday } },
			}),
		])

		// Форматируем статистику
		let message = '📊 <b>Статистика SkySEO</b>\n\n'

		// Пользователи
		message += '👥 <b>Пользователи:</b>\n'
		message += `├ Всего: ${totalUsers}\n`
		message += `├ Активных (7 дней): ${activeUsers}\n`
		message += `└ Выполняют задания: ${activeExecutors}\n\n`

		// Версии приложения
		if (usersByVersion.length > 0) {
			message += '📱 <b>Версии приложения:</b>\n'
			usersByVersion.forEach((v, index) => {
				const isLast = index === usersByVersion.length - 1
				const prefix = isLast ? '└' : '├'
				message += `${prefix} ${v.appVersion || 'Не указана'}: ${v._count.appVersion} чел.\n`
			})
			message += '\n'
		}

		// Источники регистрации
		if (usersByReferralSource.length > 0) {
			message += '📍 <b>Откуда узнали:</b>\n'
			usersByReferralSource.forEach((s, index) => {
				const isLast = index === usersByReferralSource.length - 1
				const prefix = isLast ? '└' : '├'
				message += `${prefix} ${s.referralSource || 'Не указано'}: ${s._count.referralSource} чел.\n`
			})
			message += '\n'
		}

		// Задания
		const successRate =
			completedTasks > 0
				? Math.round((foundInTopCount / completedTasks) * 100)
				: 0
		message += '📋 <b>Задания:</b>\n'
		message += `├ Всего создано: ${totalTasks}\n`
		message += `├ Активных: ${activeTasks}\n`
		message += `├ Выполнено: ${completedTasks}\n`
		message += `├ ✅ Найден в топе (полный визит): ${foundInTopCount} (${successRate}%)\n`
		message += `├ 📋 Без нахождения в топе: ${notFoundCount}\n`
		message += `├ Яндекс: ${yandexTasks}\n`
		message += `└ Google: ${googleTasks}\n\n`

		// Финансы
		const revenueTotal = Number(totalRevenue._sum.amount || 0)
		const revToday = Number(revenueTodayAgg._sum.amount || 0)
		message += '💰 <b>Финансы:</b>\n'
		message += `├ Заработано баллов: ${totalEarned._sum.amount || 0}\n`
		message += `├ Платежей всего: ${totalPayments}\n`
		message += `├ Выручка всего: ${revenueTotal.toLocaleString('ru-RU')} ₽\n`
		if (paymentsToday > 0) message += `├ Платежей сегодня: ${paymentsToday}\n`
		if (revToday > 0)      message += `├ Выручка сегодня: ${revToday.toLocaleString('ru-RU')} ₽\n`
		message += `└ ─\n\n`

		message += `🕐 Обновлено: ${now.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}`

		return message
	}

	// Получение дневной статистики (команда /daily — тот же формат что и авто-отчёт)
	private async getDailyStats(): Promise<string> {
		// Делегируем в sendDailyTelegramReport, но возвращаем строку вместо отправки
		const now = new Date()
		const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
		const dateStr = now.toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric' })

		const startOfYesterday = new Date(startOfToday.getTime() - 86400000)
		const startOfDayBefore = new Date(startOfToday.getTime() - 2 * 86400000)

		const [
			newUsersToday,
			activePCsTodaySet,
			yesterdaySet,
			dayBeforeSet,
			execFound,
			execNotFound,
			execScriptError,
			execNotInSerp,
			execLockTimeout,
			captchaYandex,
			captchaGoogle,
			earnedToday,
			spentToday,
			newTasksToday,
			paymentsToday,
			revenueToday,
			uninstalledToday,
			inactiveToday,
		] = await Promise.all([
			this.prisma.user.count({ where: { createdAt: { gte: startOfToday } } }),
			this.prisma.execution.groupBy({ by: ['executorId'], where: { createdAt: { gte: startOfToday } } }).then(r => new Set(r.map(x => x.executorId))),
			this.prisma.execution.groupBy({ by: ['executorId'], where: { createdAt: { gte: startOfYesterday, lt: startOfToday } } }).then(r => new Set(r.map(x => x.executorId))),
			this.prisma.execution.groupBy({ by: ['executorId'], where: { createdAt: { gte: startOfDayBefore, lt: startOfYesterday } } }).then(r => new Set(r.map(x => x.executorId))),
			this.prisma.execution.count({ where: { createdAt: { gte: startOfToday }, status: 'COMPLETED', foundInTop: true } }),
			this.prisma.execution.count({ where: { createdAt: { gte: startOfToday }, status: 'COMPLETED', foundInTop: false } }),
			this.prisma.execution.count({ where: { createdAt: { gte: startOfToday }, status: 'FAILED', failureReason: 'SCRIPT_ERROR' } }),
			this.prisma.execution.count({ where: { createdAt: { gte: startOfToday }, status: 'FAILED', failureReason: 'NOT_IN_SERP' } }),
			this.prisma.execution.count({ where: { createdAt: { gte: startOfToday }, status: 'FAILED', failureReason: 'LOCK_TIMEOUT' } }),
			this.prisma.executionEvent.count({ where: { createdAt: { gte: startOfToday }, type: 'captcha', engine: 'yandex' } }),
			this.prisma.executionEvent.count({ where: { createdAt: { gte: startOfToday }, type: 'captcha', engine: 'google' } }),
			this.prisma.execution.aggregate({ _sum: { pointsEarned: true }, where: { createdAt: { gte: startOfToday }, status: 'COMPLETED' } }),
			this.prisma.execution.aggregate({ _sum: { pointsSpent: true }, where: { createdAt: { gte: startOfToday }, status: 'COMPLETED' } }),
			this.prisma.task.count({ where: { createdAt: { gte: startOfToday } } }),
			this.prisma.payment.count({ where: { status: 'SUCCEEDED', paidAt: { gte: startOfToday } } }),
			this.prisma.payment.aggregate({ _sum: { amount: true }, where: { status: 'SUCCEEDED', paidAt: { gte: startOfToday } } }),
			this.prisma.user.count({ where: { appStatus: 'UNINSTALLED', lastSeenAt: { gte: startOfToday } } }),
			this.prisma.user.count({ where: { appStatus: { in: ['ACTIVE', 'REINSTALLED'] }, executions: { none: { createdAt: { gte: startOfToday } } } } }),
		])

		const activePCsToday = activePCsTodaySet.size
		const streak3 = [...activePCsTodaySet].filter(id => yesterdaySet.has(id) && dayBeforeSet.has(id)).length
		const totalToday = execFound + execNotFound + execScriptError + execNotInSerp + execLockTimeout
		const foundPct = totalToday > 0 ? Math.round((execFound / totalToday) * 100) : 0
		const revenue = Number(revenueToday._sum.amount || 0)
		const earned = earnedToday._sum.pointsEarned ?? 0
		const spent = spentToday._sum.pointsSpent ?? 0
		const totalCaptcha = captchaYandex + captchaGoogle

		let message = `📅 <b>Статистика за сегодня — ${dateStr}</b>\n\n`

		message += `👥 <b>Аудитория:</b>\n`
		if (newUsersToday > 0) message += `├ Новых: <b>${newUsersToday}</b>\n`
		message += `├ Активных ПК сегодня: <b>${activePCsToday}</b>\n`
		message += `├ 3 дня подряд: <b>${streak3}</b>\n`
		if (uninstalledToday > 0) message += `├ 🗑 Удалили сегодня: <b>${uninstalledToday}</b>\n`
		message += `└ 😴 Не использовали: <b>${inactiveToday}</b>\n\n`

		if (newTasksToday > 0) message += `📋 <b>Новых заданий:</b> ${newTasksToday}\n\n`

		message += `⚙️ <b>Задачи (${totalToday} всего, ${foundPct}% успех):</b>\n`
		if (execFound > 0)       message += `├ ✅ Найдено в топ: <b>${execFound}</b>\n`
		if (execNotFound > 0)    message += `├ 🔍 Вне топ-50: <b>${execNotFound}</b>\n`
		if (execNotInSerp > 0)   message += `├ 🚫 Нет в поиске: <b>${execNotInSerp}</b>\n`
		if (execScriptError > 0) message += `├ ❌ Ошибка скрипта: <b>${execScriptError}</b>\n`
		if (execLockTimeout > 0) message += `├ ⏱ Таймаут: <b>${execLockTimeout}</b>\n`
		if (totalToday === 0)    message += `├ Задач не было\n`
		message += `├ 🪙 Заработано: <b>${earned}</b> б.\n`
		if (spent > 0)           message += `└ 💸 Потрачено: <b>${spent}</b> б.\n`
		else                     message += `└ ─\n`
		message += '\n'

		if (totalCaptcha > 0) {
			message += `🤖 <b>Капча:</b>\n`
			if (captchaYandex > 0) message += `├ Яндекс: <b>${captchaYandex}</b>\n`
			if (captchaGoogle > 0) message += `└ Google: <b>${captchaGoogle}</b>\n`
			message += '\n'
		}

		if (paymentsToday > 0 || revenue > 0) {
			message += `💰 <b>Покупки:</b>\n`
			if (paymentsToday > 0) message += `├ Платежей: <b>${paymentsToday}</b>\n`
			if (revenue > 0)       message += `└ Выручка: <b>${revenue.toLocaleString('ru-RU')} ₽</b>\n`
			message += '\n'
		}

		message += `🕐 ${now.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}`
		return message
	}

	async sendDailyTelegramReport() {
		const now = new Date()
		const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
		const dateStr = now.toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric' })

		const startOfYesterday2 = new Date(startOfToday.getTime() - 86400000)
		const startOfDayBefore2 = new Date(startOfToday.getTime() - 2 * 86400000)

		const [
			newUsersToday,
			activePCsTodaySet2,
			yesterdaySet2,
			dayBeforeSet2,
			execFound,
			execNotFound,
			execScriptError,
			execNotInSerp,
			execLockTimeout,
			captchaYandex,
			captchaGoogle,
			earnedToday,
			spentToday,
			paymentsToday,
			revenueToday,
			uninstalledToday,
			inactiveToday,
		] = await Promise.all([
			this.prisma.user.count({ where: { createdAt: { gte: startOfToday } } }),
			this.prisma.execution.groupBy({ by: ['executorId'], where: { createdAt: { gte: startOfToday } } }).then(r => new Set(r.map(x => x.executorId))),
			this.prisma.execution.groupBy({ by: ['executorId'], where: { createdAt: { gte: startOfYesterday2, lt: startOfToday } } }).then(r => new Set(r.map(x => x.executorId))),
			this.prisma.execution.groupBy({ by: ['executorId'], where: { createdAt: { gte: startOfDayBefore2, lt: startOfYesterday2 } } }).then(r => new Set(r.map(x => x.executorId))),
			this.prisma.execution.count({ where: { createdAt: { gte: startOfToday }, status: 'COMPLETED', foundInTop: true } }),
			this.prisma.execution.count({ where: { createdAt: { gte: startOfToday }, status: 'COMPLETED', foundInTop: false } }),
			this.prisma.execution.count({ where: { createdAt: { gte: startOfToday }, status: 'FAILED', failureReason: 'SCRIPT_ERROR' } }),
			this.prisma.execution.count({ where: { createdAt: { gte: startOfToday }, status: 'FAILED', failureReason: 'NOT_IN_SERP' } }),
			this.prisma.execution.count({ where: { createdAt: { gte: startOfToday }, status: 'FAILED', failureReason: 'LOCK_TIMEOUT' } }),
			this.prisma.executionEvent.count({ where: { createdAt: { gte: startOfToday }, type: 'captcha', engine: 'yandex' } }),
			this.prisma.executionEvent.count({ where: { createdAt: { gte: startOfToday }, type: 'captcha', engine: 'google' } }),
			this.prisma.execution.aggregate({ _sum: { pointsEarned: true }, where: { createdAt: { gte: startOfToday }, status: 'COMPLETED' } }),
			this.prisma.execution.aggregate({ _sum: { pointsSpent: true }, where: { createdAt: { gte: startOfToday }, status: 'COMPLETED' } }),
			this.prisma.payment.count({ where: { status: 'SUCCEEDED', paidAt: { gte: startOfToday } } }),
			this.prisma.payment.aggregate({ _sum: { amount: true }, where: { status: 'SUCCEEDED', paidAt: { gte: startOfToday } } }),
			this.prisma.user.count({ where: { appStatus: 'UNINSTALLED', lastSeenAt: { gte: startOfToday } } }),
			this.prisma.user.count({ where: { appStatus: { in: ['ACTIVE', 'REINSTALLED'] }, executions: { none: { createdAt: { gte: startOfToday } } } } }),
		])

		const activePCsToday = activePCsTodaySet2.size
		const streak3 = [...activePCsTodaySet2].filter(id => yesterdaySet2.has(id) && dayBeforeSet2.has(id)).length
		const totalToday = execFound + execNotFound + execScriptError + execNotInSerp + execLockTimeout
		const foundPct = totalToday > 0 ? Math.round((execFound / totalToday) * 100) : 0
		const revenue = Number(revenueToday._sum.amount || 0)
		const earned = earnedToday._sum.pointsEarned ?? 0
		const spent = spentToday._sum.pointsSpent ?? 0
		const totalCaptcha = captchaYandex + captchaGoogle

		let message = `📅 <b>Дневной отчёт SkySEO — ${dateStr}</b>\n\n`

		message += `👥 <b>Аудитория:</b>\n`
		if (newUsersToday > 0) message += `├ Новых: <b>${newUsersToday}</b>\n`
		message += `├ Активных ПК сегодня: <b>${activePCsToday}</b>\n`
		message += `├ 3 дня подряд: <b>${streak3}</b>\n`
		if (uninstalledToday > 0) message += `├ 🗑 Удалили сегодня: <b>${uninstalledToday}</b>\n`
		message += `└ 😴 Не использовали: <b>${inactiveToday}</b>\n\n`

		message += `⚙️ <b>Задачи (${totalToday} всего, ${foundPct}% успех):</b>\n`
		if (execFound > 0)       message += `├ ✅ Найдено в топ: <b>${execFound}</b>\n`
		if (execNotFound > 0)    message += `├ 🔍 Вне топ-50: <b>${execNotFound}</b>\n`
		if (execNotInSerp > 0)   message += `├ 🚫 Нет в поиске: <b>${execNotInSerp}</b>\n`
		if (execScriptError > 0) message += `├ ❌ Ошибка скрипта: <b>${execScriptError}</b>\n`
		if (execLockTimeout > 0) message += `├ ⏱ Таймаут: <b>${execLockTimeout}</b>\n`
		if (totalToday === 0)    message += `├ Задач не было\n`
		message += `├ 🪙 Заработано: <b>${earned}</b> б.\n`
		if (spent > 0)           message += `└ 💸 Потрачено: <b>${spent}</b> б.\n`
		else                     message += `└ ─\n`
		message += '\n'

		if (totalCaptcha > 0) {
			message += `🤖 <b>Капча:</b>\n`
			if (captchaYandex > 0) message += `├ Яндекс: <b>${captchaYandex}</b>\n`
			if (captchaGoogle > 0) message += `└ Google: <b>${captchaGoogle}</b>\n`
			message += '\n'
		}

		if (paymentsToday > 0 || revenue > 0) {
			message += `💰 <b>Покупки:</b>\n`
			if (paymentsToday > 0) message += `├ Платежей: <b>${paymentsToday}</b>\n`
			if (revenue > 0)       message += `└ Выручка: <b>${revenue.toLocaleString('ru-RU')} ₽</b>\n`
			message += '\n'
		}

		message += `🕐 ${now.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}`

		await this.sendAdminNotification(message)

		await this.checkGoogleConsentHealth().catch(() => {})
	}

	// Куки SOCS протухают → Google снова показывает окно согласия. Приложение логирует
	// событие consent/shown каждый раз, когда окно всё-таки вылезло. Если за сутки это
	// случается в большинстве заходов на Google — шлём один алерт (просим обновить куку).
	async checkGoogleConsentHealth() {
		const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
		// Числитель и знаменатель считаем из ОДНОГО источника (execution_events, по createdAt),
		// иначе ratio мог превысить 1: заход с consent часто проваливает парсинг и не попадал
		// в прежний знаменатель (executions.googleFoundInTop != null).
		// Знаменатель = число Google-заходов = distinct executionId среди google-событий за сутки.
		const [consentShown, googleRunGroups] = await Promise.all([
			this.prisma.executionEvent.count({
				where: { type: 'consent', engine: 'google', stage: 'shown', createdAt: { gte: since } },
			}),
			this.prisma.executionEvent.groupBy({
				by: ['executionId'],
				where: { engine: 'google', executionId: { not: null }, createdAt: { gte: since } },
			}),
		])
		const googleRuns = googleRunGroups.length

		if (googleRuns < 5) return // мало данных — не шумим
		const ratio = Math.min(consentShown / googleRuns, 1)
		if (ratio < 0.5) return // куки ещё работают
		if (Date.now() - this.lastConsentAlertAt < 24 * 60 * 60 * 1000) return // дебаунс 24ч
		this.lastConsentAlertAt = Date.now()

		const pct = Math.round(ratio * 100)
		await this.sendAdminNotification(
			`⚠️ <b>Google: куки согласия протухли</b>\n\n` +
				`За сутки окно согласия вылезло в <b>${pct}%</b> заходов на Google (${consentShown}/${googleRuns}).\n` +
				`Поиск в Google из-за этого почти не находит сайты.\n\n` +
				`Что сделать: открой google.com в инкогнито → «Принять все» → DevTools → Application → Cookies → скопируй <b>SOCS</b> → вставь в админке: <b>/holfizz/settings</b>`,
		)
	}
}
