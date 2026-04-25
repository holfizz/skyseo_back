import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Telegraf } from 'telegraf'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class TelegramService {
	private bot: Telegraf | null = null
	private adminId: string
	private isEnabled: boolean = false

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

			// Запускаем бота для обработки команд
			this.bot.launch().catch(err => {
				console.error('❌ Failed to launch bot:', err)
			})

			// Отправляем тестовое сообщение при инициализации (только в dev режиме)
			if (
				this.configService.get('NODE_ENV') === 'development' &&
				this.adminId
			) {
				try {
					await this.bot.telegram.sendMessage(
						this.adminId,
						'🤖 Telegram bot initialized successfully!',
					)
					console.log('✅ Test message sent to admin')
				} catch (testError) {
					console.error('❌ Failed to send test message:', testError.message)
				}
			}

			// Graceful shutdown
			process.once('SIGINT', () => this.bot?.stop('SIGINT'))
			process.once('SIGTERM', () => this.bot?.stop('SIGTERM'))
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

	async sendAdminNotification(message: string) {
		console.log('[TelegramService] Attempting to send notification...')
		console.log('[TelegramService] Bot enabled:', this.isEnabled)
		console.log('[TelegramService] Admin ID:', this.adminId ? 'set' : 'not set')
		console.log('[TelegramService] Bot instance:', this.bot ? 'exists' : 'null')

		if (!this.isEnabled || !this.adminId || !this.bot) {
			console.log('[Telegram disabled]:', message)
			return
		}

		try {
			console.log(
				'[TelegramService] Sending message to admin ID:',
				this.adminId,
			)
			await this.bot.telegram.sendMessage(this.adminId, message, {
				parse_mode: 'HTML',
			})
			console.log('[TelegramService] Message sent successfully')
		} catch (error) {
			console.error(
				'[TelegramService] Failed to send notification:',
				error.message,
			)
			console.error('[TelegramService] Full error:', error)

			// Если ошибка связана с сетью, пытаемся переподключиться
			if (
				error.message.includes('ECONNRESET') ||
				error.message.includes('ENOTFOUND') ||
				error.message.includes('timeout')
			) {
				console.log('🔄 Telegram: Network error, attempting reconnect...')

				// Переинициализируем бота
				const token = this.configService.get('TELEGRAM_BOT_TOKEN')
				if (token) {
					setTimeout(() => {
						this.initializeBot(token)
					}, 5000) // Ждем 5 секунд перед переподключением
				}
			}
		}
	}

	async sendRegistrationNotification(
		email: string,
		city: string,
		source: string,
		ipAddress: string,
		balance: number,
	) {
		const message =
			`🆕 <b>Новая регистрация</b>\n\n` +
			`📧 Email: ${email}\n` +
			`🌍 Город: ${city || 'Не указан'}\n` +
			`📍 Источник: ${source || 'Не указан'}\n` +
			`🌐 IP: ${ipAddress || 'Не определен'}\n` +
			`💰 Баланс: ${balance} баллов\n` +
			`🕐 Время: ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}`

		await this.sendAdminNotification(message)
	}

	async sendPaymentNotification(email: string, amount: number, points: number) {
		const message =
			`💰 <b>Новый платеж</b>\n\n` +
			`👤 Email: ${email}\n` +
			`💵 Сумма: ${amount.toFixed(2)} ₽\n` +
			`⭐ Начислено баллов: ${points}\n` +
			`🕐 Время: ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}`

		await this.sendAdminNotification(message)
	}

	async sendAppInstallNotification(email: string, appVersion?: string) {
		const message =
			`📱 <b>Установка приложения</b>\n\n` +
			`👤 Email: ${email}\n` +
			`📦 Версия: ${appVersion || 'Не указана'}\n` +
			`🕐 Время: ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}`

		await this.sendAdminNotification(message)
	}

	async sendComplaintNotification(
		text: string,
		contact?: string,
		userEmail?: string,
	) {
		console.log('[TelegramService] Sending complaint notification:', {
			text,
			contact,
			userEmail,
		})

		const message =
			`⚠️ <b>Новая жалоба</b>\n\n` +
			`📝 Текст: ${text || 'Не указан'}\n` +
			`📧 Email пользователя: ${userEmail || 'Не авторизован'}\n` +
			`📞 Контакт для связи: ${contact || 'Не указан'}`

		await this.sendAdminNotification(message)
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

			// Активных исполнителей (выполняли задачи)
			this.prisma.execution
				.groupBy({
					by: ['executorId'],
					where: { status: 'COMPLETED' },
				})
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
		message += '📋 <b>Задания:</b>\n'
		message += `├ Всего создано: ${totalTasks}\n`
		message += `├ Активных: ${activeTasks}\n`
		message += `├ Выполнено: ${completedTasks}\n`
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
}
