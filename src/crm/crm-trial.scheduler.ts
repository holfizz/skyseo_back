import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../prisma/prisma.service'
import { CrmBotService } from './crm-bot.service'

const escapeHtml = (s: string) =>
	String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * За сутки до конца бесплатной недели готовит менеджеру карточку: контакт человека
 * и готовый текст сообщения, который остаётся скопировать и отправить руками.
 *
 * Почему руками, а не ботом: Telegram не даёт боту написать первым тому, кто с ним
 * не начинал диалог. Первое холодное касание в любом случае делает человек.
 *
 * Защита от дублей двухслойная: TrialOutreach.userId уникален (ловит гонку и рестарт),
 * плюс статус QUEUED → SENT_TO_MANAGER захватывается через updateMany с проверкой count.
 */
@Injectable()
export class CrmTrialScheduler implements OnModuleInit {
	private readonly logger = new Logger(CrmTrialScheduler.name)
	private running = false

	constructor(
		private prisma: PrismaService,
		private bot: CrmBotService,
		private config: ConfigService,
	) {}

	onModuleInit() {
		if (this.config.get('CRM_ENABLED') === 'false') return
		// Раз в час: сутки до конца — окно широкое, чаще смысла нет.
		setTimeout(() => this.tick(), 30_000)
		setInterval(() => this.tick(), 60 * 60 * 1000).unref()
	}

	private async tick() {
		if (this.running) return
		this.running = true
		try {
			const now = new Date()
			const in24h = new Date(now.getTime() + DAY_MS)

			// TrialOutreach живёт без relation на User (связь по userId), поэтому
			// уже обработанных исключаем явным списком, а не вложенным условием.
			const already = await this.prisma.trialOutreach.findMany({
				select: { userId: true },
			})

			// Кому подписка истекает в ближайшие сутки и кто ещё ни разу не платил
			// (то есть сидит именно на бесплатной неделе, а не на продлении).
			const candidates = await this.prisma.user.findMany({
				where: {
					trialStartedAt: { not: null },
					paidUntil: { gt: now, lte: in24h },
					payments: { none: { status: 'SUCCEEDED' } },
					id: { notIn: already.map(a => a.userId) },
				},
				select: {
					id: true,
					email: true,
					telegramUsername: true,
					paidUntil: true,
					trialStartedAt: true,
				},
				take: 50,
			})
			if (candidates.length === 0) return

			const managers = await this.getManagers()
			if (managers.length === 0) {
				this.logger.warn('Некому слать карточки: нет активных MANAGER с Telegram')
				return
			}

			for (const user of candidates) {
				const site = await this.prisma.website.findFirst({
					where: { userId: user.id, isApproved: true },
					select: { id: true, url: true },
					orderBy: { createdAt: 'asc' },
				})

				const [keywords, visits] = await Promise.all([
					site
						? this.prisma.task.count({
								where: { websiteId: site.id, isActive: true, keywordStatus: 'ACTIVE' },
							})
						: Promise.resolve(0),
					site
						? this.prisma.execution.count({
								where: {
									websiteId: site.id,
									status: 'COMPLETED',
									foundInTop: true,
									completedAt: { gte: user.trialStartedAt ?? undefined },
								},
							})
						: Promise.resolve(0),
				])

				// userId уникален — при гонке или повторном тике вставка упадёт, и это нормально.
				let row: { id: string }
				try {
					row = await this.prisma.trialOutreach.create({
						data: {
							userId: user.id,
							email: user.email,
							telegram: user.telegramUsername,
							websiteUrl: site?.url ?? null,
							visits,
							keywords,
							trialEndsAt: user.paidUntil!,
							status: 'QUEUED',
						},
						select: { id: true },
					})
				} catch {
					continue // карточка по этому юзеру уже есть
				}

				const claim = await this.prisma.trialOutreach.updateMany({
					where: { id: row.id, status: 'QUEUED' },
					data: { status: 'SENT_TO_MANAGER' },
				})
				if (claim.count !== 1) continue

				const card = this.renderCard({
					telegram: user.telegramUsername,
					email: user.email,
					url: site?.url ?? null,
					keywords,
					visits,
				})
				const keyboard = [[
					{ text: '✅ Отправила', callback_data: `trial_sent_${row.id}` },
					{ text: '⚠️ Не получилось', callback_data: `trial_failed_${row.id}` },
				]]

				let delivered = false
				for (const m of managers) {
					if (await this.bot.sendWithButtons(m.telegramId, card, keyboard)) delivered = true
				}
				if (!delivered) {
					this.logger.warn(`Карточка ${row.id}: не доставлена ни одному менеджеру`)
				}
			}
		} catch (e) {
			this.logger.error('trial tick failed', e as Error)
		} finally {
			this.running = false
		}
	}

	/** Активные сотрудники с ролью MANAGER на платформе и привязанным CRM-телеграмом. */
	private async getManagers(): Promise<Array<{ telegramId: string }>> {
		const staff = await this.prisma.user.findMany({
			where: { OR: [{ roles: { has: 'MANAGER' } }, { role: 'MANAGER' }] },
			select: { id: true },
		})
		if (staff.length === 0) return []
		const profiles = await this.prisma.crmUser.findMany({
			where: {
				userId: { in: staff.map(s => s.id) },
				isActive: true,
				telegramId: { not: null },
			},
			select: { telegramId: true },
		})
		return profiles.filter(p => !!p.telegramId) as Array<{ telegramId: string }>
	}

	/**
	 * Карточка: шапка с контактом и готовый текст в <pre>. Тап по такому блоку
	 * в Telegram даёт «копировать» — это и есть просьба про тройные бэктики,
	 * просто в HTML-разметке (sendMessage у нас жёстко на parse_mode: 'HTML').
	 */
	private renderCard(d: {
		telegram: string | null
		email: string
		url: string | null
		keywords: number
		visits: number
	}): string {
		const site = d.url ?? 'сайт не указан'
		const contact = d.telegram ? `@${d.telegram}` : `почта: ${d.email}`

		const message = d.visits > 0
			? `Здравствуйте! По вашему сайту ${site} за неделю тестового продвижения было ` +
				`${d.visits} ${plural(d.visits, 'визит', 'визита', 'визитов')} по ` +
				`${d.keywords} ${plural(d.keywords, 'ключу', 'ключам', 'ключам')}. ` +
				`Посмотрите в Яндекс.Метрике, как ведут себя эти визиты — глубина просмотра и время на сайте. ` +
				`Если хотите довести сайт до топ-10, давайте обсудим.`
			: `Здравствуйте! По вашему сайту ${site} за неделю тестового продвижения визитов не было — ` +
				`это значит, что по вашим ключам сайт пока не попадает в топ-50 Яндекса, ` +
				`а продвигать можно только то, что там уже есть. Мы можем помочь подобрать ключи, ` +
				`по которым вы уже в топ-50, и работать с ними. Давайте обсудим.`

		return (
			`⏳ <b>Триал заканчивается завтра</b>\n\n` +
			`${escapeHtml(contact)}\n` +
			`${escapeHtml(site)} · ${d.keywords} ${plural(d.keywords, 'ключ', 'ключа', 'ключей')} · ` +
			`${d.visits} ${plural(d.visits, 'визит', 'визита', 'визитов')}\n\n` +
			`<pre>${escapeHtml(message)}</pre>`
		)
	}
}

function plural(n: number, one: string, few: string, many: string): string {
	const m10 = n % 10
	const m100 = n % 100
	if (m10 === 1 && m100 !== 11) return one
	if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few
	return many
}
