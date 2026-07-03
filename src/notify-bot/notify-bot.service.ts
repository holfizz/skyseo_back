import { Injectable, OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { randomInt } from 'crypto'
import { Telegraf } from 'telegraf'
import { PrismaService } from '../prisma/prisma.service'

/**
 * Отдельный Telegram-бот для уведомлений ПОЛЬЗОВАТЕЛЯМ (@skyseo_notification_bot).
 * Не путать с админским ботом (TelegramService) — это разные боты и разные токены.
 * Привязка: юзер жмёт deep-link t.me/<bot>?start=<код> ИЛИ отправляет 6-значный код в бот.
 */
@Injectable()
export class NotifyBotService implements OnModuleDestroy {
	private bot: Telegraf | null = null
	private isEnabled = false
	private botUsername = 'skyseo_notification_bot'
	private readonly CODE_TTL_MS = 15 * 60 * 1000 // код привязки живёт 15 минут

	constructor(
		private configService: ConfigService,
		private prisma: PrismaService,
	) {
		const token = this.configService.get('TELEGRAM_NOTIFY_BOT_TOKEN')
		if (token && token !== 'dummy-token' && token.length >= 20) {
			this.initializeBot(token)
		} else {
			console.log('⚠️ Notify-bot disabled (no TELEGRAM_NOTIFY_BOT_TOKEN)')
		}
	}

	private async initializeBot(token: string) {
		try {
			this.bot = new Telegraf(token)
			this.setupHandlers()

			const timeout = new Promise((_, reject) =>
				setTimeout(() => reject(new Error('Connection timeout')), 10000),
			)
			const botInfo: any = await Promise.race([this.bot.telegram.getMe(), timeout])
			this.botUsername = botInfo.username || this.botUsername
			this.isEnabled = true
			console.log(`✅ Notify-bot connected: @${this.botUsername}`)

			this.bot.launch().catch(err =>
				console.error('[NotifyBot] Polling error:', err.message),
			)
		} catch (error: any) {
			console.log('⚠️ Notify-bot connection failed:', error.message)
			this.bot = null
			this.isEnabled = false
		}
	}

	private setupHandlers() {
		if (!this.bot) return

		// deep-link: /start <код>
		this.bot.start(async ctx => {
			const payload = (ctx as any).startPayload as string | undefined
			if (payload && /^\d{6}$/.test(payload.trim())) {
				await this.tryLink(ctx, payload.trim())
				return
			}
			await ctx.reply(
				'Это бот уведомлений SkySEO. Чтобы получать уведомления, откройте личный кабинет → раздел «Уведомления» и нажмите «Привязать Telegram», либо пришлите сюда 6-значный код из кабинета.',
			)
		})

		// ручной ввод 6-значного кода
		this.bot.on('text', async ctx => {
			const text = (ctx.message as any)?.text?.trim() || ''
			if (/^\d{6}$/.test(text)) {
				await this.tryLink(ctx, text)
			}
		})
	}

	private async tryLink(ctx: any, code: string) {
		const user = await this.prisma.user.findFirst({
			where: {
				telegramLinkCode: code,
				telegramLinkCodeExpiresAt: { gt: new Date() },
			},
			select: { id: true },
		})
		if (!user) {
			await ctx.reply('Код недействителен или истёк. Сгенерируйте новый в личном кабинете.')
			return
		}
		const chatId = String(ctx.chat.id)
		const username = ctx.from?.username || null

		// Один chat_id — один аккаунт: снимаем привязку у прежнего владельца этого чата
		await this.prisma.user.updateMany({
			where: { telegramChatId: chatId, NOT: { id: user.id } },
			data: { telegramChatId: null },
		})
		await this.prisma.user.update({
			where: { id: user.id },
			data: {
				telegramChatId: chatId,
				telegramUsername: username,
				telegramLinkedAt: new Date(),
				telegramLinkCode: null,
				telegramLinkCodeExpiresAt: null,
			},
		})
		await ctx.reply('Готово. Уведомления SkySEO будут приходить сюда.')
	}

	/** Генерирует одноразовый код привязки и deep-link. */
	async generateLinkCode(userId: string): Promise<{ code: string; deepLink: string }> {
		let code = ''
		// подбираем уникальный 6-значный код
		for (let i = 0; i < 8; i++) {
			code = String(randomInt(100000, 1000000))
			const clash = await this.prisma.user.findFirst({
				where: { telegramLinkCode: code },
				select: { id: true },
			})
			if (!clash) break
		}
		await this.prisma.user.update({
			where: { id: userId },
			data: {
				telegramLinkCode: code,
				telegramLinkCodeExpiresAt: new Date(Date.now() + this.CODE_TTL_MS),
			},
		})
		return { code, deepLink: `https://t.me/${this.botUsername}?start=${code}` }
	}

	async getStatus(userId: string): Promise<{ linked: boolean; username: string | null }> {
		const user = await this.prisma.user.findUnique({
			where: { id: userId },
			select: { telegramChatId: true, telegramUsername: true },
		})
		return {
			linked: !!user?.telegramChatId,
			username: user?.telegramUsername ?? null,
		}
	}

	async unlink(userId: string): Promise<void> {
		await this.prisma.user.update({
			where: { id: userId },
			data: {
				telegramChatId: null,
				telegramUsername: null,
				telegramLinkCode: null,
				telegramLinkCodeExpiresAt: null,
				telegramLinkedAt: null,
			},
		})
	}

	/** Отправка сообщения пользователю в бот уведомлений. Тихо игнорирует ошибки/непривязанных. */
	async sendToChat(
		chatId: string | null | undefined,
		text: string,
		button?: { text: string; url: string },
	): Promise<void> {
		if (!this.isEnabled || !this.bot || !chatId) return
		try {
			await this.bot.telegram.sendMessage(chatId, text, {
				parse_mode: 'HTML',
				link_preview_options: { is_disabled: true },
				...(button
					? { reply_markup: { inline_keyboard: [[{ text: button.text, url: button.url }]] } }
					: {}),
			} as any)
		} catch (err: any) {
			console.log('[NotifyBot] sendToChat failed:', err?.message)
		}
	}

	onModuleDestroy() {
		try {
			this.bot?.stop('SIGTERM')
		} catch {}
	}
}
