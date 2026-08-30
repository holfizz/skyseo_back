import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { OutreachService } from '../outreach/outreach.service'
import { TelegramService } from '../telegram/telegram.service'

const DAY_MS = 24 * 60 * 60 * 1000

/** Полночь по UTC: спринты хранятся датами без времени, сравниваем в той же шкале. */
function startOfDay(d: Date): Date {
	return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}
function daysBetween(a: Date, b: Date): number {
	return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / DAY_MS)
}

@Injectable()
export class SprintService {
	constructor(
		private prisma: PrismaService,
		private outreach: OutreachService,
		private telegram: TelegramService,
	) {}

	/**
	 * Спринт, в котором мы сейчас.
	 * До старта плана берём ближайший будущий, после финиша — последний.
	 * Без этого перед стартом подставлялся 17-й спринт: «текущего» нет, а
	 * запасная ветка брала последний по номеру.
	 */
	private async currentSprint() {
		const today = startOfDay(new Date())
		const running = await this.prisma.sprint.findFirst({
			where: { startsOn: { lte: today }, endsOn: { gte: today } },
		})
		if (running) return running
		const upcoming = await this.prisma.sprint.findFirst({
			where: { startsOn: { gt: today } },
			orderBy: { startsOn: 'asc' },
		})
		return upcoming ?? (await this.prisma.sprint.findFirst({ orderBy: { number: 'desc' } }))
	}

	/**
	 * Сколько ПК реально в сети. Тот же источник, что и у потолка выдачи задач
	 * (AppConfigService), — чтобы цифры в двух кабинетах не разъезжались.
	 */
	private async networkSize(): Promise<number> {
		return this.prisma.user.count({ where: { appStatus: { in: ['ACTIVE', 'REINSTALLED'] } } })
	}

	/**
	 * Дневная норма с учётом долга.
	 *
	 * Долг копится ВНУТРИ недели и обнуляется вместе со спринтом: спрашивается
	 * недельный итог, а день — только ориентир. Иначе одна провальная неделя
	 * сделала бы план невыполнимым до самого декабря.
	 */
	private async progress(sprint: { id: string; startsOn: Date; endsOn: Date; messagesDay: number; messagesWeek: number }) {
		const today = startOfDay(new Date())
		const tomorrow = new Date(today.getTime() + DAY_MS)
		const weekStart = startOfDay(sprint.startsOn)

		const [doneWeek, doneToday] = await Promise.all([
			this.prisma.outreachTouch.count({
				where: { step: 1, createdAt: { gte: weekStart, lt: tomorrow } },
			}),
			this.prisma.outreachTouch.count({
				where: { step: 1, createdAt: { gte: today, lt: tomorrow } },
			}),
		])

		// Номер дня внутри спринта: 1 — понедельник старта.
		// Если неделя ещё не началась (план стартует позже), долга быть не может.
		const rawDay = daysBetween(weekStart, today) + 1
		const started = rawDay >= 1
		const dayIndex = Math.min(7, Math.max(1, rawDay))
		// Отметки, сделанные до старта недели, в doneWeek не попадают — без
		// клампа разница уходила в минус и надувала дневную норму.
		const doneBeforeToday = Math.max(0, doneWeek - doneToday)
		const expectedBeforeToday = started ? (dayIndex - 1) * sprint.messagesDay : 0
		const debt = Math.max(0, expectedBeforeToday - doneBeforeToday)
		// Больше недельного плана сегодня требовать не с чего.
		const leftInWeek = Math.max(0, sprint.messagesWeek - doneBeforeToday)
		const todayTarget = Math.min(sprint.messagesDay + debt, leftInWeek)

		return { dayIndex, doneWeek, doneToday, debt, todayTarget, leftInWeek, started }
	}

	/**
	 * Незакрытый разбор недели. Комментарий обязателен каждое воскресенье,
	 * независимо от того, выполнен план или нет: по выполненным неделям тоже
	 * важно знать, что именно сработало.
	 */
	private async pendingReview() {
		const today = startOfDay(new Date())
		const sprint = await this.prisma.sprint.findFirst({
			where: { endsOn: { lte: today }, review: { is: null } },
			orderBy: { endsOn: 'desc' },
		})
		if (!sprint) return null
		const done = await this.prisma.outreachTouch.count({
			where: {
				step: 1,
				createdAt: { gte: startOfDay(sprint.startsOn), lt: new Date(startOfDay(sprint.endsOn).getTime() + DAY_MS) },
			},
		})
		return { sprint, done, plan: sprint.messagesWeek, met: done >= sprint.messagesWeek }
	}

	async getDashboard() {
		const sprint = await this.currentSprint()
		if (!sprint) throw new NotFoundException('Спринты не заведены')

		const [p, network, review] = await Promise.all([
			this.progress(sprint),
			this.networkSize(),
			this.pendingReview(),
		])

		return {
			sprint: {
				number: sprint.number,
				focus: sprint.focus,
				startsOn: sprint.startsOn,
				endsOn: sprint.endsOn,
				messagesWeek: sprint.messagesWeek,
				messagesDay: sprint.messagesDay,
				networkTarget: sprint.networkTarget,
			},
			today: {
				// false — спринт ещё не начался, цифры дня показываем как ориентир
				started: p.started,
				dayIndex: p.dayIndex,
				target: p.todayTarget,
				done: p.doneToday,
				debt: p.debt, // сколько «недобрали» за прошлые дни недели
				left: Math.max(0, p.todayTarget - p.doneToday),
			},
			week: {
				plan: sprint.messagesWeek,
				done: p.doneWeek,
				left: p.leftInWeek,
				percent: sprint.messagesWeek ? Math.round((p.doneWeek / sprint.messagesWeek) * 100) : 0,
			},
			network: { actual: network, target: sprint.networkTarget },
			pendingReview: review
				? { sprintId: review.sprint.id, number: review.sprint.number, done: review.done, plan: review.plan, met: review.met }
				: null,
		}
	}

	/**
	 * Очередь менеджера тремя этапами. Отмеченный контакт НЕ исчезает, а переезжает
	 * в следующую группу: раньше после отметки лид пропадал из обеих выборок, если
	 * ещё не ответил, и менеджер терял его из виду совсем.
	 *
	 *   1. Стартовое сообщение — первое касание ещё не отправлено
	 *   2. Второе сообщение    — первое отправлено, лид в работе
	 *   3. Оплатил             — статус PAID, финал воронки
	 *
	 * Отказавшихся не показываем ни в первой, ни во второй группе: писать им больше
	 * нечего, но и удалять их из базы нельзя, они нужны в статистике.
	 */
	async getQueue(limit = 20) {
		// Общее условие: только хэндлы, вписанные руками (см. telegramManual в схеме).
		const reachable: Prisma.OutreachLeadWhereInput = {
			telegramManual: true,
			telegram: { not: null },
			NOT: { telegram: '' },
		}
		// Отказавшихся и оплативших в рабочих группах не показываем.
		const active: Prisma.EnumOutreachStatusFilter = { notIn: ['PAID', 'REJECTED'] }

		const [first, second, paid] = await Promise.all([
			this.prisma.outreachLead.findMany({
				where: { ...reachable, status: active, touches: { none: { step: 1 } } },
				orderBy: [{ score: 'desc' }, { createdAt: 'asc' }],
				take: limit,
				include: { touches: { select: { step: true } } },
			}),
			this.prisma.outreachLead.findMany({
				where: { ...reachable, status: active, touches: { some: { step: 1 } } },
				orderBy: { updatedAt: 'desc' },
				take: limit,
				include: { touches: { select: { step: true } } },
			}),
			this.prisma.outreachLead.findMany({
				where: { ...reachable, status: 'PAID' },
				orderBy: { updatedAt: 'desc' },
				take: limit,
				include: { touches: { select: { step: true } } },
			}),
		])

		return {
			first: await Promise.all(first.map(l => this.card(l, 1))),
			second: await Promise.all(second.map(l => this.card(l, 2))),
			paid: await Promise.all(paid.map(l => this.card(l, 2))),
		}
	}

	private async card(lead: any, step: 1 | 2) {
		const opening = (await this.outreach.getOpeningMessage(lead.id)).message
		// Второе сообщение пересобираем только тогда, когда его действительно шлют.
		// Для карточек первого шага показываем сохранённый текст: свежая сборка
		// каждого лида дёргает Вордстат по всем его ключам, и очередь из двадцати
		// карточек превращалась бы в шестьдесят запросов на каждое открытие.
		// Пустой message бывает у лидов, заведённых мимо импорта: там текст никто не
		// собирал. Тогда строим на месте, иначе менеджер увидит пустой блок.
		const second =
			step === 2 || !lead.message
				? (await this.outreach.getMessage(lead.id)).message
				: lead.message
		const text = step === 1 ? opening : second
		// В поле бывает несколько хэндлов через запятую («@company_bot, @ceo»).
		// Раньше строка шла в ссылку целиком, и получалось t.me/@a, @b — битый адрес.
		// Берём первый и чистим от префиксов.
		const tg = (lead.telegram || '')
			.split(',')[0]
			.trim()
			.replace(/^https?:\/\/t\.me\//, '')
			.replace(/^@/, '')
			.trim()
		const steps: number[] = (lead.touches ?? []).map((t: any) => t.step)
		return {
			id: lead.id,
			domain: lead.domain,
			// Что уже отправлено — чтобы карточка во второй группе показывала,
			// ждём ли мы ответа на первое или второе уже ушло.
			firstSent: steps.includes(1),
			secondSent: steps.includes(2),
			companyName: lead.companyName,
			fio: [lead.lastName, lead.firstName, lead.middleName].filter(Boolean).join(' ') || null,
			telegram: tg ? '@' + tg : null,
			tgLink: tg ? `https://t.me/${tg}?text=${encodeURIComponent(text)}` : null,
			status: lead.status,
			step,
			text,
			// Оба текста разом: менеджер видит, что отправит сейчас и что пойдёт после ответа.
			openingText: opening,
			secondText: second,
			// Подробности для раскрытой карточки.
			city: lead.city,
			inn: lead.inn,
			phone: lead.phone,
			email: lead.email,
			whatsapp: lead.whatsapp,
			notes: lead.notes,
			keywords: lead.keywords,
			keywordsCount: lead.keywordsCount,
			bestPosition: lead.bestPosition,
			// Ссылку на PDF собирает фронт: он знает адрес API, бэкенду про это знать незачем.
			reportToken: lead.reportToken,
			reportOpens: lead.reportOpens,
			reportOpenedAt: lead.reportOpenedAt,
			contactedAt: lead.contactedAt,
			createdAt: lead.createdAt,
		}
	}

	/**
	 * Смена статуса лида из кабинета менеджера.
	 *
	 * Отдельно от админской PATCH-ручки: там правится вся карточка целиком,
	 * включая телеграм, а менеджеру можно менять только статус.
	 */
	async setLeadStatus(leadId: string, status: string) {
		const allowed = ['NEW', 'CONTACTED', 'INTERESTED', 'REJECTED', 'PAID']
		if (!allowed.includes(status)) throw new BadRequestException('Неизвестный статус')
		const lead = await this.prisma.outreachLead.findUnique({ where: { id: leadId }, select: { id: true } })
		if (!lead) throw new NotFoundException('Лид не найден')
		const updated = await this.prisma.outreachLead.update({
			where: { id: leadId },
			data: {
				status: status as any,
				...(status === 'CONTACTED' ? { contactedAt: new Date() } : {}),
			},
			select: { id: true, status: true },
		})
		return { ok: true, ...updated }
	}

	/** Отметка «отправил». Повторная отметка не удваивает счёт (UNIQUE в базе). */
	async markSent(userId: string, leadId: string, step: number) {
		if (step !== 1 && step !== 2) throw new BadRequestException('step должен быть 1 или 2')
		const lead = await this.prisma.outreachLead.findUnique({ where: { id: leadId } })
		if (!lead) throw new NotFoundException('Лид не найден')

		await this.prisma.outreachTouch.upsert({
			where: { leadId_step: { leadId, step } },
			create: { leadId, userId, step },
			update: {}, // дата первой отправки не переписывается
		})
		// Первое сообщение переводит лида в «Отправил», если он ещё новый.
		if (step === 1 && lead.status === 'NEW') {
			await this.prisma.outreachLead.update({
				where: { id: leadId },
				data: { status: 'CONTACTED', contactedAt: new Date() },
			})
		}
		return { ok: true }
	}

	/** Разбор недели. Уходит в Telegram админу сразу после сохранения. */
	async submitReview(userId: string, sprintId: string, comment: string) {
		const text = String(comment || '').trim()
		if (text.length < 10) throw new BadRequestException('Напишите хотя бы пару предложений')

		const sprint = await this.prisma.sprint.findUnique({ where: { id: sprintId } })
		if (!sprint) throw new NotFoundException('Спринт не найден')

		const done = await this.prisma.outreachTouch.count({
			where: {
				step: 1,
				createdAt: { gte: startOfDay(sprint.startsOn), lt: new Date(startOfDay(sprint.endsOn).getTime() + DAY_MS) },
			},
		})
		const met = done >= sprint.messagesWeek
		const author = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true } })

		const review = await this.prisma.sprintReview.upsert({
			where: { sprintId },
			create: { sprintId, comment: text, authorId: userId },
			update: { comment: text, authorId: userId },
		})

		const msg =
			`${met ? '✅' : '⚠️'} <b>Спринт ${sprint.number} закрыт</b>\n` +
			`План: ${sprint.messagesWeek}, сделано: <b>${done}</b>${met ? '' : ` (не хватило ${sprint.messagesWeek - done})`}\n` +
			`Фокус: ${sprint.focus}\n\n` +
			`<b>Комментарий</b> (${author?.email ?? 'менеджер'}):\n${text}`
		const sent = await this.telegram.sendAdminNotification(msg).then(() => true).catch(() => false)
		if (sent) {
			await this.prisma.sprintReview.update({ where: { id: review.id }, data: { sentAt: new Date() } })
		}
		return { ok: true, sentToTelegram: sent }
	}

	// ── Админская часть ────────────────────────────────────────────────────────

	/**
	 * KPI до зимы. Главная цель и награда живут в коде: это личная договорённость,
	 * а не настройка — менять её через админку смысла нет.
	 */
	async getKpi() {
		const GOAL_CLIENTS = 25
		const AVG_CHECK = 9000
		const REWARD = 'Rick Owens Geobaskets или ремень Saint Laurent'
		const DEADLINE = new Date('2026-12-27T00:00:00Z')

		const today = startOfDay(new Date())
		const [payingUsers, sprint, network, sprints] = await Promise.all([
			// Платящий = есть успешная оплата. Считаем людей, а не платежи.
			this.prisma.payment.findMany({ where: { status: 'SUCCEEDED' }, select: { userId: true }, distinct: ['userId'] }),
			this.currentSprint(),
			this.networkSize(),
			this.prisma.sprint.findMany({ orderBy: { number: 'asc' } }),
		])
		const clients = payingUsers.length

		// Что сделал менеджер: за сегодня, за неделю и всего.
		const weekStart = sprint ? startOfDay(sprint.startsOn) : today
		const [sentToday, sentWeek, sentTotal, repliedTotal] = await Promise.all([
			this.prisma.outreachTouch.count({ where: { step: 1, createdAt: { gte: today } } }),
			this.prisma.outreachTouch.count({ where: { step: 1, createdAt: { gte: weekStart } } }),
			this.prisma.outreachTouch.count({ where: { step: 1 } }),
			this.prisma.outreachTouch.count({ where: { step: 2 } }),
		])

		const weeksLeft = Math.max(0, Math.ceil((DEADLINE.getTime() - today.getTime()) / (7 * DAY_MS)))

		return {
			goal: {
				clients: GOAL_CLIENTS,
				avgCheck: AVG_CHECK,
				targetMrr: GOAL_CLIENTS * AVG_CHECK,
				deadline: DEADLINE,
				reward: REWARD,
				weeksLeft,
			},
			progress: {
				clients,
				mrr: clients * AVG_CHECK,
				percent: Math.round((clients / GOAL_CLIENTS) * 100),
				network,
				networkTarget: sprint?.networkTarget ?? 0,
			},
			manager: {
				sentToday,
				sentWeek,
				sentTotal,
				repliedTotal,
				// Доля ответивших: по ней проверяется правило «ниже 5% три недели — дело в скрипте».
				replyRate: sentTotal ? Math.round((repliedTotal / sentTotal) * 1000) / 10 : 0,
			},
			sprints: sprints.map(s => ({
				id: s.id,
				number: s.number,
				startsOn: s.startsOn,
				endsOn: s.endsOn,
				focus: s.focus,
				messagesWeek: s.messagesWeek,
				messagesDay: s.messagesDay,
				networkTarget: s.networkTarget,
				current: !!sprint && s.id === sprint.id,
			})),
		}
	}

	async listSprints() {
		const sprints = await this.prisma.sprint.findMany({
			orderBy: { number: 'asc' },
			include: { review: { select: { comment: true, createdAt: true, sentAt: true } } },
		})
		// Факт по каждой неделе — чтобы в админке было видно, где план не закрыт.
		const done = await Promise.all(
			sprints.map(s =>
				this.prisma.outreachTouch.count({
					where: {
						step: 1,
						createdAt: { gte: startOfDay(s.startsOn), lt: new Date(startOfDay(s.endsOn).getTime() + DAY_MS) },
					},
				}),
			),
		)
		return sprints.map((s, i) => ({ ...s, done: done[i], met: done[i] >= s.messagesWeek }))
	}

	/** Правка целей. Меняем только то, что прислали, остальное не трогаем. */
	async updateSprint(
		id: string,
		body: { messagesWeek?: number; messagesDay?: number; networkTarget?: number; focus?: string },
	) {
		const num = (v: unknown, field: string, hi: number) => {
			const n = Number(v)
			if (!Number.isFinite(n) || n < 0 || n > hi) throw new BadRequestException(`${field}: допустимо 0-${hi}`)
			return Math.round(n)
		}
		const data: Record<string, unknown> = {}
		if (body.messagesWeek != null) data.messagesWeek = num(body.messagesWeek, 'План на неделю', 5000)
		if (body.messagesDay != null) data.messagesDay = num(body.messagesDay, 'План на день', 1000)
		if (body.networkTarget != null) data.networkTarget = num(body.networkTarget, 'Сеть ПК', 100000)
		if (body.focus != null) {
			const f = String(body.focus).trim()
			if (!f) throw new BadRequestException('Фокус: пустое значение')
			data.focus = f.slice(0, 500)
		}
		if (Object.keys(data).length === 0) throw new BadRequestException('Нечего менять')
		return this.prisma.sprint.update({ where: { id }, data })
	}
}
