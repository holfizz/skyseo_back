import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Telegraf } from 'telegraf'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class TelegramService {
	private bot: Telegraf | null = null
	private adminId: string
	private isEnabled: boolean = false

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
		} catch (error) {
			console.log('⚠️ Telegram bot connection failed:', error.message)
			console.log('⚠️ Telegram notifications disabled')
			this.bot = null
			this.isEnabled = false
		}
	}

	private setupCommands() {
		if (!this.bot) return

		// Команда /start
		this.bot.command('start', async ctx => {
			await ctx.reply(
				'👋 Привет! Я бот SkySEO.\n\n' +
					'Доступные команды:\n' +
					'/stats - Общая статистика платформы\n' +
					'/daily - Статистика за сегодня',
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
		userEmail: string
		websiteName: string
		websiteUrl: string
	}) {
		const message =
			`🌐 <b>Новый сайт добавлен</b>\n\n` +
			`👤 Аккаунт: ${data.userEmail}\n` +
			`📌 Название: ${data.websiteName}\n` +
			`🔗 Ссылка: ${data.websiteUrl}\n` +
			`🕐 Время: ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}`

		await this.sendAdminNotification(message, this.TOPIC_WEBSITES)
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
		message += '💰 <b>Финансы:</b>\n'
		message += `├ Заработано баллов: ${totalEarned._sum.amount || 0}\n`
		message += `├ Платежей: ${totalPayments}\n`
		message += `└ Выручка: ${Number(totalRevenue._sum.amount || 0).toFixed(2)} ₽\n\n`

		message += `🕐 Обновлено: ${now.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}`

		return message
	}

	// Получение дневной статистики
	private async getDailyStats(): Promise<string> {
		const now = new Date()
		const startOfToday = new Date(
			now.getFullYear(),
			now.getMonth(),
			now.getDate(),
		)

		// Получаем данные за сегодня
		const [
			newUsersToday,
			newTasksToday,
			completedTasksToday,
			paymentsToday,
			revenueToday,
			activeExecutorsToday,
		] = await Promise.all([
			// Новые пользователи
			this.prisma.user.count({
				where: { createdAt: { gte: startOfToday } },
			}),

			// Новые задания
			this.prisma.task.count({
				where: { createdAt: { gte: startOfToday } },
			}),

			// Выполненные задания
			this.prisma.execution.count({
				where: {
					status: 'COMPLETED',
					completedAt: { gte: startOfToday },
				},
			}),

			// Платежи
			this.prisma.payment.count({
				where: {
					status: 'SUCCEEDED',
					paidAt: { gte: startOfToday },
				},
			}),

			// Выручка
			this.prisma.payment.aggregate({
				_sum: { amount: true },
				where: {
					status: 'SUCCEEDED',
					paidAt: { gte: startOfToday },
				},
			}),

			// Активные исполнители
			this.prisma.execution
				.groupBy({
					by: ['executorId'],
					where: {
						createdAt: { gte: startOfToday },
					},
				})
				.then(result => result.length),
		])

		let message = '📅 <b>Статистика за сегодня</b>\n\n'

		message += '👥 <b>Пользователи:</b>\n'
		message += `├ Новых: ${newUsersToday}\n`
		message += `└ Активных: ${activeExecutorsToday}\n\n`

		message += '📋 <b>Задания:</b>\n'
		message += `├ Создано: ${newTasksToday}\n`
		message += `└ Выполнено: ${completedTasksToday}\n\n`

		message += '💰 <b>Финансы:</b>\n'
		message += `├ Платежей: ${paymentsToday}\n`
		message += `└ Выручка: ${Number(revenueToday._sum.amount || 0).toFixed(2)} ₽\n\n`

		message += `🕐 ${now.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}`

		return message
	}

	async sendDailyTelegramReport() {
		const now = new Date()
		const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())

		const [sitesFoundToday, activePCsToday] = await Promise.all([
			this.prisma.execution.count({
				where: { status: 'COMPLETED', foundInTop: true, completedAt: { gte: startOfToday } },
			}),
			this.prisma.execution
				.groupBy({ by: ['executorId'], where: { completedAt: { gte: startOfToday } } })
				.then(r => r.length),
		])

		const message =
			`📅 <b>Дневной отчёт SkySEO</b>\n\n` +
			`🖥 ПК в сети: <b>${activePCsToday}</b>\n` +
			`🎯 Сайтов найдено в топе: <b>${sitesFoundToday}</b>\n\n` +
			`🕐 ${now.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}`

		await this.sendAdminNotification(message)
	}
}
