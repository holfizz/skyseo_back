import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { Api } from 'teleproto'
import bigInt from 'big-integer'
import { PrismaService } from '../prisma/prisma.service'
import { TelegramService } from '../telegram/telegram.service'
import { TgWarmupService } from './tg-warmup.service'
import { call, classifyError, TgError, withClient } from './tg-client'
import { fillTemplate, missingPlaceholders } from './campaign-text'
import { distributeDaily } from './warmup-plan'

/**
 * Рассылка в Telegram с прогретых аккаунтов.
 *
 * Три независимые части:
 *   1. Отправщик — раз в минуту смотрит, кому пора писать, и пишет.
 *   2. Опросник — раз в минуту спрашивает Telegram, что с отправленным:
 *      прочитали, ответили, недоступен.
 *   3. Воронка — считает то, что реально известно, и ничего не додумывает.
 *
 * ЧЕСТНО ПРО «ЗАБЛОКИРОВАЛ». Telegram не сообщает, что вас заблокировали.
 * В блок попадает только то, о чём сервер сказал прямо: закрытые настройки
 * приватности, удалённый аккаунт, явная ошибка при отправке. Молчаливую
 * блокировку от «просто не прочитал» отличить нельзя, и выдавать одно за
 * другое в цифрах я не стал.
 *
 * ПРО ПРАВИЛА TELEGRAM. В документации к api_id написано прямо: за флуд и спам
 * банят навсегда, а любой аккаунт, вошедший через неофициальный клиент, попадает
 * под наблюдение. Поэтому пределы здесь по умолчанию низкие, считаются на каждый
 * аккаунт отдельно и связаны со здоровьем аккаунта: спамблок или второй
 * PEER_FLOOD останавливают отправку сами, без участия человека.
 */

type SendVerdict = 'sent' | 'skipped' | 'failed'

/**
 * Чем сузить опрос и сколько на него отведено времени.
 *
 * deadlineMs задаёт ТОЛЬКО ручной вызов: ответ на нажатие кнопки обязан
 * вернуться, даже если половина пула не отзывается. Расписание не спешит и
 * дожимает всех, поэтому оттуда предел не передаётся.
 */
export type PollFilter = { campaignId?: string; recipientId?: string; deadlineMs?: number }

/** Когда и с какого аккаунта уйдёт сообщение конкретному адресату. */
export type PlannedSend = {
	at: string
	accountId: string
	accountLabel: string | null
	tgUserId: string | null
}

export type PollResult = {
	/** Сколько аккаунтов опросили. */
	accounts: number
	/** Сколько переписок проверяли. */
	checked: number
	/** В скольких что-то изменилось. */
	changed: number
	/** Сколько новых ответов нашли. */
	replies: number
	/** Сколько аккаунтов не отозвались. */
	failed: number
	/** Сколько переписок не успели проверить: время вышло, зайдите ещё раз. */
	skipped: number
}

/**
 * Случайная минута внутри окна.
 *
 * Если окно на сегодня уже кончилось — берём завтрашнее. Если оно идёт прямо
 * сейчас, отсчитываем от текущего момента, а не от начала окна: иначе запуск
 * в четыре часа дня назначал бы первое сообщение на десять утра, то есть в
 * прошлое, и оно ушло бы немедленно.
 */
function randomStart(now: Date, fromHour: number, toHour: number): Date {
	const dayStart = new Date(now)
	dayStart.setHours(fromHour, 0, 0, 0)
	const dayEnd = new Date(now)
	dayEnd.setHours(toHour, 0, 0, 0)

	// Хвост окна короче получаса — не втискиваемся, начинаем завтра.
	const earliest = Math.max(dayStart.getTime(), now.getTime())
	if (earliest > dayEnd.getTime() - 30 * 60_000) {
		const t = new Date(now.getTime() + 86400000)
		t.setHours(fromHour, 0, 0, 0)
		return new Date(t.getTime() + Math.random() * Math.max(1, (toHour - fromHour) * 3600_000) * 0.4)
	}
	return new Date(earliest + Math.random() * (dayEnd.getTime() - earliest) * 0.35)
}

/**
 * Фильтр списка адресатов.
 *
 * Кнопки называют ЭТАП, а не статус, и это не одно и то же. Ответивший после
 * нашего письма становится SECOND_SENT, и фильтр по одному лишь REPLIED
 * показывал пустой список — хотя человек ответил. Так же и «не дошло»: это и
 * блокировка, и ошибка отправки, и снятый вручную.
 */
function recipientFilter(group?: string) {
	switch (group) {
		case 'replied':
			return { status: { in: ['REPLIED', 'SECOND_SENT'] as any[] } }
		case 'queued':
			return { status: { in: ['QUEUED'] as any[] } }
		case 'sent':
			return { status: { in: ['SENT', 'READ'] as any[] } }
		case 'problem':
			return { status: { in: ['BLOCKED', 'FAILED', 'STOPPED'] as any[] } }
		default:
			return {}
	}
}

/** Начало окна в указанный день от сегодняшнего (0 — сегодня, 1 — завтра). */
function windowStart(now: Date, hour: number, dayShift: number): Date {
	const d = new Date(now)
	d.setDate(d.getDate() + dayShift)
	d.setHours(hour, 0, 0, 0)
	return d
}

/** Ключ суток для дневных счётчиков. */
function dayKey(d: Date): string {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Причины, по которым писать этому человеку нельзя и повторять бессмысленно. */
const HOPELESS = new Set([
	'USER_PRIVACY_RESTRICTED', 'USER_IS_BLOCKED', 'YOU_BLOCKED_USER',
	'INPUT_USER_DEACTIVATED', 'USER_DEACTIVATED', 'USERNAME_NOT_OCCUPIED',
	'USERNAME_INVALID', 'PEER_ID_INVALID', 'USER_ID_INVALID', 'CONTACT_ID_INVALID',
	'PHONE_NUMBER_INVALID',
])

function hopelessReason(message: string): string | null {
	for (const code of HOPELESS) if (message.includes(code)) return code
	return null
}

const REASON_RU: Record<string, string> = {
	USER_PRIVACY_RESTRICTED: 'закрыты настройки приватности — писать нельзя',
	USER_IS_BLOCKED: 'заблокировал',
	YOU_BLOCKED_USER: 'мы сами заблокировали этого человека',
	INPUT_USER_DEACTIVATED: 'аккаунт удалён',
	USER_DEACTIVATED: 'аккаунт удалён',
	USERNAME_NOT_OCCUPIED: 'такого юзернейма не существует',
	USERNAME_INVALID: 'юзернейм записан неверно',
	PEER_ID_INVALID: 'адресат не найден',
	USER_ID_INVALID: 'адресат не найден',
	CONTACT_ID_INVALID: 'адресат не найден',
	PHONE_NUMBER_INVALID: 'номер записан неверно',
}

@Injectable()
export class CampaignService {
	private readonly logger = new Logger(CampaignService.name)
	/** Очередь опросов: см. pollTick. */
	private chain: Promise<void> = Promise.resolve()

	constructor(
		private prisma: PrismaService,
		private warmup: TgWarmupService,
		private telegram: TelegramService,
	) {}

	// ── кампании ─────────────────────────────────────────────────────────────

	async list() {
		const rows = await this.prisma.tgCampaign.findMany({
			orderBy: { createdAt: 'desc' },
			include: { _count: { select: { recipients: true, accounts: true } } },
		})
		const stats = await this.statsByCampaign(rows.map(r => r.id))
		return rows.map(c => ({
			id: c.id, name: c.name, status: c.status,
			perAccountPerDay: c.perAccountPerDay,
			windowFrom: c.windowFrom, windowTo: c.windowTo,
			createdAt: c.createdAt, startedAt: c.startedAt,
			recipients: c._count.recipients,
			accounts: c._count.accounts,
			funnel: stats.get(c.id) ?? this.emptyFunnel(),
		}))
	}

	async create(body: { name?: string; firstMessage?: string; secondMessage?: string }) {
		if (!body?.firstMessage?.trim()) throw new BadRequestException('Пустой текст первого сообщения')
		return this.prisma.tgCampaign.create({
			data: {
				name: body.name?.trim() || 'Без названия',
				firstMessage: body.firstMessage.trim(),
				secondMessage: body.secondMessage?.trim() || null,
			},
			select: { id: true },
		})
	}

	async update(id: string, body: any) {
		const data: any = {}
		for (const k of ['name', 'firstMessage', 'secondMessage']) {
			if (typeof body?.[k] === 'string') data[k] = body[k].trim() || null
		}
		for (const k of ['perAccountPerDay', 'minIntervalSec', 'maxIntervalSec', 'windowFrom', 'windowTo']) {
			if (body?.[k] !== undefined && body[k] !== null && body[k] !== '') data[k] = Number(body[k])
		}
		// Цель дня отдельно: пустое поле здесь имеет смысл — «цели нет,
		// работаем по личным потолкам», и его надо уметь сохранить.
		if (body?.dailyGoal !== undefined) {
			const goal = body.dailyGoal === null || body.dailyGoal === '' ? null : Number(body.dailyGoal)
			if (goal !== null && (!Number.isFinite(goal) || goal < 1 || goal > 5000)) {
				throw new BadRequestException('Цель дня: от 1 до 5000 сообщений, либо пусто')
			}
			data.dailyGoal = goal
		}
		if (data.perAccountPerDay !== undefined && (data.perAccountPerDay < 1 || data.perAccountPerDay > 200)) {
			throw new BadRequestException('Сообщений в день на аккаунт: от 1 до 200')
		}
		if (data.minIntervalSec !== undefined && data.maxIntervalSec !== undefined && data.minIntervalSec > data.maxIntervalSec) {
			throw new BadRequestException('Минимальная пауза больше максимальной')
		}
		if (data.windowFrom !== undefined && data.windowTo !== undefined && data.windowFrom >= data.windowTo) {
			throw new BadRequestException('Окно отправки задано наоборот: конец раньше начала')
		}
		if (!data.name) delete data.name
		if (!data.firstMessage) delete data.firstMessage
		await this.prisma.tgCampaign.update({ where: { id }, data })
		return { ok: true }
	}

	async remove(id: string) {
		await this.prisma.tgCampaign.delete({ where: { id } })
		return { ok: true }
	}

	async setStatus(id: string, status: 'RUNNING' | 'PAUSED' | 'DONE') {
		const c = await this.prisma.tgCampaign.findUnique({
			where: { id },
			include: { _count: { select: { accounts: true, recipients: true } } },
		})
		if (!c) throw new NotFoundException('Кампания не найдена')
		if (status === 'RUNNING') {
			if (!c._count.accounts) throw new BadRequestException('Не выбрано ни одного аккаунта для отправки')
			if (!c._count.recipients) throw new BadRequestException('Список адресатов пуст')
		}
		await this.prisma.tgCampaign.update({
			where: { id },
			data: {
				status,
				startedAt: status === 'RUNNING' && !c.startedAt ? new Date() : c.startedAt,
				finishedAt: status === 'DONE' ? new Date() : null,
			},
		})

		// При запуске раскидываем аккаунты по времени. Без этого все они писали
		// бы в первую же минуту после нажатия кнопки: одновременный старт пула —
		// самое заметное, что можно сделать, никакие паузы между сообщениями
		// этого уже не исправят.
		if (status === 'RUNNING') return { ok: true, schedule: await this.scheduleStart(id) }
		return { ok: true }
	}

	/**
	 * Разложить первый выход каждого аккаунта по случайной минуте внутри окна.
	 *
	 * Только первый: дальше темп задают паузы между сообщениями. Аккаунты, уже
	 * стоящие в очереди с прошлого запуска, не трогаем — иначе пауза после
	 * FLOOD_WAIT сбрасывалась бы каждым нажатием «Запустить».
	 */
	private async scheduleStart(campaignId: string) {
		const c = await this.prisma.tgCampaign.findUnique({
			where: { id: campaignId },
			include: { accounts: { include: { account: { select: { id: true, label: true, avatar: true, status: true } } } } },
		})
		if (!c) return []

		const now = new Date()
		const out: Array<{ id: string; label: string | null; avatar: string | null; at: Date | null; why?: string }> = []

		for (const link of c.accounts) {
			const acc = link.account
			if (acc.status === 'BANNED' || acc.status === 'ERROR' || acc.status === 'PAUSED') {
				out.push({ id: acc.id, label: acc.label, avatar: acc.avatar, at: null, why: 'не в работе' })
				continue
			}
			if (link.pausedUntil && link.pausedUntil > now) {
				out.push({ id: acc.id, label: acc.label, avatar: acc.avatar, at: link.pausedUntil, why: 'на паузе после ошибки' })
				continue
			}

			const at = randomStart(now, c.windowFrom, c.windowTo)
			await this.prisma.tgCampaignAccount.update({ where: { id: link.id }, data: { nextSendAt: at } })
			out.push({ id: acc.id, label: acc.label, avatar: acc.avatar, at })
		}
		return out.sort((a, b) => (a.at?.getTime() ?? Infinity) - (b.at?.getTime() ?? Infinity))
	}

	/** Какие аккаунты работают в кампании. Полная замена списка. */
	async setAccounts(campaignId: string, accountIds: string[]) {
		const ids = [...new Set(accountIds ?? [])]
		await this.prisma.tgCampaignAccount.deleteMany({
			where: { campaignId, accountId: { notIn: ids.length ? ids : ['-'] } },
		})
		for (const accountId of ids) {
			await this.prisma.tgCampaignAccount.upsert({
				where: { campaignId_accountId: { campaignId, accountId } },
				create: { campaignId, accountId },
				update: {},
			})
		}
		return { accounts: ids.length }
	}

	// ── адресаты ─────────────────────────────────────────────────────────────

	/**
	 * Добавить адресатов текстом: по одному в строке, юзернейм или телефон,
	 * через точку с запятой можно дописать имя, отчество и сайт.
	 *
	 *   @ivan_petrov; Иван; Петрович; kuhni-vologda.ru
	 *   +79001234567; Мария
	 */
	async addRecipientsFromText(campaignId: string, text: string) {
		const rows: any[] = []
		const rejected: Array<{ line: number; text: string; reason: string }> = []
		const lines = String(text ?? '').split(/\r?\n/)

		for (let i = 0; i < lines.length; i++) {
			const raw = lines[i].trim()
			if (!raw || raw.startsWith('#')) continue
			const [who, first, middle, domain] = raw.split(';').map(p => p.trim())
			const username = who.startsWith('@') || /^[a-z0-9_]{4,32}$/i.test(who)
				? who.replace(/^@/, '').toLowerCase()
				: null
			const phone = !username && /^\+?\d{10,15}$/.test(who.replace(/[\s()-]/g, ''))
				? who.replace(/[\s()-]/g, '').replace(/^\+/, '')
				: null
			if (!username && !phone) {
				rejected.push({ line: i + 1, text: raw, reason: 'не похоже ни на юзернейм, ни на телефон' })
				continue
			}
			rows.push({
				campaignId, username, phone,
				firstName: first || null, middleName: middle || null, domain: domain || null,
			})
		}
		return { ...(await this.insertRecipients(campaignId, rows)), rejected }
	}

	/**
	 * Забрать адресатов из базы лидов.
	 *
	 * Только те, у кого телеграм проставлен РУКАМИ (telegramManual): спарсенные
	 * с сайта контакты — это чаще всего общий канал компании, а не человек.
	 */
	async addRecipientsFromLeads(campaignId: string, limit = 200) {
		// Берём с запасом: часть отсеется как «уже писали» или «кривой юзернейм»,
		// и без запаса «дай двадцать» превращалось бы в три.
		const want = Math.max(1, Math.min(1000, limit))
		const leads = await this.prisma.outreachLead.findMany({
			where: {
				telegramManual: true,
				telegram: { not: null },
				// Лиды из дев-сида в рассылку не берём. Их юзернеймы выдуманы, а
				// пространство имён в Telegram настоящее: один такой контакт уже
				// оказался живым человеком, и ему ушло письмо с чужим именем.
				NOT: { notes: { contains: 'дев-сид' } },
			},
			select: {
				id: true, telegram: true, firstName: true, middleName: true, lastName: true,
				companyName: true, domain: true,
			},
			orderBy: { createdAt: 'desc' },
			take: want * 5,
		})
		const rows = leads
			.map(l => {
				const handle = String(l.telegram ?? '').trim().replace(/^https?:\/\/t\.me\//i, '').replace(/^@/, '')
				if (!/^[a-z0-9_]{4,32}$/i.test(handle)) return null
				return {
					campaignId, username: handle.toLowerCase(), phone: null, leadId: l.id,
					firstName: l.firstName, middleName: l.middleName, lastName: l.lastName,
					company: l.companyName, domain: l.domain,
				}
			})
			.filter(Boolean) as any[]
		return this.insertRecipients(campaignId, rows, want)
	}

	/**
	 * Вставка адресатов.
	 *
	 * Отсеиваются двое: те, кто уже есть в этой кампании, и те, кому мы УЖЕ
	 * писали из любой другой. Второе важнее: списки пересекаются постоянно, а
	 * два одинаковых «здравствуйте, ждал будние» с разных аккаунтов — это самое
	 * заметное, что можно сделать. Человек в лучшем случае перестанет отвечать.
	 */
	private async insertRecipients(campaignId: string, rows: any[], take?: number) {
		if (!rows.length) return { added: 0, duplicates: 0, alreadyWritten: 0 }

		const inThis = await this.prisma.tgRecipient.findMany({
			where: { campaignId },
			select: { username: true, phone: true },
		})
		const seen = new Set(inThis.map(e => e.username ?? e.phone))

		// Отсев по ВСЕЙ базе адресатов, а не только по отправленным: человек,
		// стоящий в очереди другой рассылки, — это тот же человек. Добавить его
		// сюда значит запланировать ему два первых сообщения.
		const keys = rows.map(r => r.username ?? r.phone).filter(Boolean)
		const contacted = await this.prisma.tgRecipient.findMany({
			where: {
				campaignId: { not: campaignId },
				OR: [{ username: { in: keys } }, { phone: { in: keys } }],
			},
			select: { username: true, phone: true },
		})
		const written = new Set(contacted.flatMap(e => [e.username, e.phone].filter(Boolean) as string[]))

		let duplicates = 0
		let alreadyWritten = 0
		const fresh = rows.filter(r => {
			const key = r.username ?? r.phone
			if (seen.has(key)) {
				duplicates++
				return false
			}
			if (written.has(key)) {
				alreadyWritten++
				return false
			}
			seen.add(key)
			return true
		})
		const chosen = take ? fresh.slice(0, take) : fresh
		if (chosen.length) await this.prisma.tgRecipient.createMany({ data: chosen })
		return { added: chosen.length, duplicates, alreadyWritten, available: fresh.length }
	}

	/**
	 * Набрать в рассылку N последних контактов, которым ещё не писали.
	 *
	 * Берутся только лиды с телеграмом, проставленным РУКАМИ: спарсенный с
	 * сайта контакт — это обычно общий канал компании, а не человек, и первое
	 * касание туда уходит впустую.
	 *
	 * Если кампания не указана, заводим новую и берём тексты из последней:
	 * они уже выверены, а начинать каждый раз с пустого поля — верный способ
	 * запустить рассылку с недописанным текстом.
	 */
	async quickFill(count: number, campaignId?: string, opts?: { windowFrom?: number; windowTo?: number; start?: boolean }) {
		const n = Math.max(1, Math.min(500, Math.round(count || 20)))

		let target = campaignId
			? await this.prisma.tgCampaign.findUnique({ where: { id: campaignId } })
			: null
		if (campaignId && !target) throw new NotFoundException('Кампания не найдена')

		let created = false
		if (!target) {
			// Рассылка называется датой дня. Если сегодняшняя уже заведена и не
			// закрыта — пополняем её, а не заводим вторую с тем же именем:
			// нажать кнопку дважды за день дело обычное.
			const name = new Date().toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
			target = await this.prisma.tgCampaign.findFirst({
				where: { name, status: { in: ['DRAFT', 'RUNNING', 'PAUSED'] } },
				orderBy: { createdAt: 'desc' },
			})
		}

		if (!target) {
			const last = await this.prisma.tgCampaign.findFirst({
				orderBy: { createdAt: 'desc' },
				where: { firstMessage: { not: '' } },
			})
			if (!last) {
				throw new BadRequestException(
					'Не с чего начать: создайте первую кампанию с текстом, дальше он будет подставляться сам',
				)
			}
			target = await this.prisma.tgCampaign.create({
				data: {
					name: new Date().toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }),
					firstMessage: last.firstMessage,
					secondMessage: last.secondMessage,
					dailyGoal: last.dailyGoal,
					perAccountPerDay: last.perAccountPerDay,
					minIntervalSec: last.minIntervalSec,
					maxIntervalSec: last.maxIntervalSec,
					windowFrom: last.windowFrom,
					windowTo: last.windowTo,
					// Аккаунты наследуем от предыдущей: выбирать их заново каждый
					// раз — лишний шаг, а состав пула меняется редко.
					accounts: {
						create: (
							await this.prisma.tgCampaignAccount.findMany({
								where: { campaignId: last.id },
								select: { accountId: true },
							})
						).map(a => ({ accountId: a.accountId })),
					},
				},
			})
			created = true
		}

		// Окно применяем до набора: если тут же запускаем, расписание должно
		// считаться уже по новому времени, а не по унаследованному.
		const from = Number(opts?.windowFrom)
		const to = Number(opts?.windowTo)
		if (Number.isFinite(from) && Number.isFinite(to)) {
			if (from >= to) throw new BadRequestException('Окно отправки задано наоборот: конец раньше начала')
			await this.prisma.tgCampaign.update({ where: { id: target.id }, data: { windowFrom: from, windowTo: to } })
			target = { ...target, windowFrom: from, windowTo: to }
		}

		// «Взять двадцать и запустить» означает двадцать ЗА СЕГОДНЯ. Без цели дня
		// каждый аккаунт работал бы по своему потолку, и очередь растягивалась
		// на неделю — что и выглядело как «почему разные дни».
		if (opts?.start) {
			await this.prisma.tgCampaign.update({ where: { id: target.id }, data: { dailyGoal: n } })
			target = { ...target, dailyGoal: n }
		}

		const res = await this.addRecipientsFromLeads(target.id, n)

		// Если только что завели кампанию и никого не набрали — убираем её за
		// собой. Иначе каждое нажатие на исчерпанной базе оставляет пустышку,
		// и список зарастает «Рассылка 02.09» без единого адресата.
		if (created && res.added === 0) {
			await this.prisma.tgCampaign.delete({ where: { id: target.id } })
			return { campaignId: null, name: target.name, created: false, ...res, started: false, schedule: null,
				windowFrom: target.windowFrom, windowTo: target.windowTo }
		}

		let schedule: any[] | null = null
		if (opts?.start && res.added > 0) {
			const started = await this.setStatus(target.id, 'RUNNING')
			schedule = (started as any).schedule ?? null
		}

		const plan = await this.forecast(target.id)
		const queued = await this.prisma.tgRecipient.count({ where: { campaignId: target.id, status: 'QUEUED' } })

		return {
			campaignId: target.id, name: target.name, created, ...res,
			started: !!schedule, schedule,
			finishAt: plan.finishAt,
			// Сколько из очереди реально уложится сегодня и что мешает остальным.
			today: plan.today,
			queued,
			bottleneck: await this.bottleneck(target, queued, plan.today),
			windowFrom: target.windowFrom, windowTo: target.windowTo,
		}
	}

	/**
	 * Почему сегодня уйдёт не вся очередь.
	 *
	 * Причин ровно три, и они разные по действию: мало аккаунтов, низкий потолок
	 * на аккаунт, короткое окно. Писать «не влезло» без причины бесполезно —
	 * человек не поймёт, что чинить.
	 */
	private async bottleneck(campaign: any, queued: number, today: number): Promise<string | null> {
		if (today >= queued) return null

		const links = await this.prisma.tgCampaignAccount.findMany({
			where: { campaignId: campaign.id },
			include: { account: true },
		})
		let usable = 0
		for (const l of links) {
			const a = l.account
			if (a.status === 'BANNED' || a.status === 'ERROR' || a.status === 'PAUSED') continue
			const allow = await this.warmup.allowanceFor(a, 0)
			if (allow.allowOutgoing) usable++
		}
		if (!usable) return 'ни один аккаунт не может отправлять — проверьте статусы и спам-блок'

		const capPerDay = usable * campaign.perAccountPerDay
		if (queued > capPerDay) {
			return `потолок ${campaign.perAccountPerDay} на аккаунт при ${usable} ${usable === 1 ? 'аккаунте' : 'аккаунтах'} даёт ${capPerDay} в день — поднимите потолок или добавьте аккаунтов`
		}

		const avgPauseMin = (campaign.minIntervalSec + campaign.maxIntervalSec) / 2 / 60
		const fits = Math.floor(((campaign.windowTo - campaign.windowFrom) * 60) / Math.max(1, avgPauseMin)) * usable
		if (queued > fits) {
			return `в окно ${campaign.windowFrom}:00-${campaign.windowTo}:00 при паузах около ${Math.round(avgPauseMin)} мин помещается примерно ${fits} — расширьте окно или сократите паузы`
		}
		return 'окно на сегодня почти закончилось — остаток уйдёт завтра'
	}

	/**
	 * Готовность аккаунтов к холодной рассылке.
	 *
	 * Отдельно от allowanceFor: тот отвечает «можно ли писать вообще», а здесь
	 * вопрос другой — стоит ли писать НЕЗНАКОМЫМ. Порог выше: свежий аккаунт
	 * технически может отправить сообщение, но именно на холодных исходящих
	 * его и снесут.
	 */
	async accountsReadiness(campaignId: string) {
		const links = await this.prisma.tgCampaignAccount.findMany({
			where: { campaignId },
			include: { account: true },
		})
		const rows = []
		for (const l of links) {
			const a = l.account
			const allow = await this.warmup.allowanceFor(a, 0)
			const probe: any = a.probe ?? {}
			const daysManaged = Math.floor((Date.now() - a.createdAt.getTime()) / 86400000)

			// Чего не хватает — по тем же признакам, что и в оценке готовности,
			// но списком дел, а не баллом: балл не говорит, что делать.
			const todo: string[] = []
			if (!a.probe) todo.push('не проверен ни разу — нажмите «Проверить и оценить»')
			if (a.status === 'BANNED') todo.push('заблокирован')
			else if (a.status === 'PAUSED') todo.push('на паузе')
			if (!a.proxyId) todo.push('без прокси: пойдёт с адреса сервера')
			if (daysManaged < 7) todo.push(`под нашим управлением ${daysManaged} ${daysManaged === 1 ? 'день' : 'дн'} из 7`)
			if ((a.actionsTotal ?? 0) < 30) todo.push(`действий ${a.actionsTotal ?? 0} из 30`)
			if ((probe.dialogs ?? 0) + (probe.channels ?? 0) < 12) todo.push('меньше 12 чатов и подписок')
			if (a.probe && !(probe.hasFirstName && probe.hasUsername && probe.photoCount > 0)) {
				todo.push('профиль неполный: имя, юзернейм, фото')
			}
			if (probe.spamBlock && probe.spamBlock !== 'clean' && probe.spamBlock !== 'unknown') todo.push('спам-блок')
			if ((a.peerFloods ?? 0) > 0) todo.push('был PEER_FLOOD')

			rows.push({
				id: a.id, label: a.label, avatar: a.avatar, tgUserId: a.tgUserId, status: a.status,
				readiness: allow.readiness,
				allowOutgoing: allow.allowOutgoing,
				// Ниже 70 холодные сообщения слать рано: это тот же порог, по
				// которому считается «прогрет» в разделе прогрева.
				coldReady: allow.allowOutgoing && allow.readiness >= 70 && !!a.probe,
				todo,
			})
		}
		return rows.sort((a, b) => b.readiness - a.readiness)
	}

	async removeRecipient(id: string) {
		await this.prisma.tgRecipient.delete({ where: { id } })
		return { ok: true }
	}

	// ── воронка ──────────────────────────────────────────────────────────────

	private emptyFunnel() {
		return {
			total: 0, sent: 0, read: 0, replied: 0, blocked: 0, failed: 0,
			second: 0, queued: 0,
			readPct: 0, repliedPct: 0, blockedPct: 0, failedPct: 0, secondPct: 0, sentPct: 0,
			replyToSecondPct: 0,
		}
	}

	private pct(part: number, whole: number): number {
		return whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0
	}

	/**
	 * Воронка по кампаниям одним запросом.
	 *
	 * Проценты считаются от ОТПРАВЛЕННЫХ, а не от всего списка: доля прочтений
	 * от числа адресатов, которым ещё не писали, — бессмысленная цифра, которая
	 * растёт сама по себе по мере рассылки.
	 */
	async statsByCampaign(ids: string[]) {
		const out = new Map<string, ReturnType<CampaignService['emptyFunnel']>>()
		if (!ids.length) return out

		const rows = await this.prisma.tgRecipient.findMany({
			where: { campaignId: { in: ids } },
			select: {
				campaignId: true, status: true,
				sentAt: true, readAt: true, repliedAt: true, secondSentAt: true, blockedAt: true,
			},
		})
		for (const id of ids) out.set(id, this.emptyFunnel())
		for (const r of rows) {
			const f = out.get(r.campaignId)!
			f.total++
			if (r.sentAt) f.sent++
			if (r.readAt) f.read++
			if (r.repliedAt) f.replied++
			if (r.secondSentAt) f.second++
			if (r.blockedAt) f.blocked++
			if (r.status === 'FAILED') f.failed++
			if (r.status === 'QUEUED') f.queued++
		}
		for (const f of out.values()) {
			f.sentPct = this.pct(f.sent, f.total)
			f.readPct = this.pct(f.read, f.sent)
			f.repliedPct = this.pct(f.replied, f.sent)
			f.blockedPct = this.pct(f.blocked, f.sent)
			f.failedPct = this.pct(f.failed, f.total)
			f.secondPct = this.pct(f.second, f.sent)
			// Отдельная цифра: сколько из ответивших дошли до второго касания.
			f.replyToSecondPct = this.pct(f.second, f.replied)
		}
		return out
	}

	/** Общая воронка — по всем кампаниям сразу, для шапки раздела. */
	async overallFunnel() {
		const ids = (await this.prisma.tgCampaign.findMany({ select: { id: true } })).map(c => c.id)
		const per = await this.statsByCampaign(ids)
		const all = this.emptyFunnel()
		for (const f of per.values()) {
			all.total += f.total; all.sent += f.sent; all.read += f.read
			all.replied += f.replied; all.second += f.second
			all.blocked += f.blocked; all.failed += f.failed; all.queued += f.queued
		}
		all.sentPct = this.pct(all.sent, all.total)
		all.readPct = this.pct(all.read, all.sent)
		all.repliedPct = this.pct(all.replied, all.sent)
		all.blockedPct = this.pct(all.blocked, all.sent)
		all.failedPct = this.pct(all.failed, all.total)
		all.secondPct = this.pct(all.second, all.sent)
		all.replyToSecondPct = this.pct(all.second, all.replied)
		return all
	}

	/**
	 * Всё для окна статистики: воронка, разбивка по дням и по кампаниям.
	 *
	 * Отдельной ручкой, а не в общем обзоре: эти цифры нужны раз в день, а
	 * список кампаний открывают постоянно. Тащить их в каждый запрос значит
	 * платить лишним обходом всей базы адресатов на каждое обновление списка.
	 */
	async stats(days = 14) {
		const span = Math.max(7, Math.min(90, days))
		const since = new Date()
		since.setHours(0, 0, 0, 0)
		since.setDate(since.getDate() - (span - 1))

		const rows = await this.prisma.tgRecipient.findMany({
			where: { OR: [{ sentAt: { gte: since } }, { readAt: { gte: since } }, { repliedAt: { gte: since } }] },
			select: { sentAt: true, readAt: true, repliedAt: true },
		})

		// Ряд строим сплошным, включая пустые дни: провалы в рассылке — это и
		// есть то, ради чего на график смотрят.
		const byDay = new Map<string, { date: string; sent: number; read: number; replied: number }>()
		for (let i = 0; i < span; i++) {
			const d = new Date(since)
			d.setDate(d.getDate() + i)
			byDay.set(dayKey(d), { date: dayKey(d), sent: 0, read: 0, replied: 0 })
		}
		const bump = (at: Date | null, field: 'sent' | 'read' | 'replied') => {
			if (!at) return
			const cell = byDay.get(dayKey(at))
			if (cell) cell[field]++
		}
		for (const r of rows) {
			bump(r.sentAt, 'sent')
			bump(r.readAt, 'read')
			bump(r.repliedAt, 'replied')
		}

		const campaigns = await this.prisma.tgCampaign.findMany({
			orderBy: { createdAt: 'desc' },
			select: { id: true, name: true, status: true },
		})
		const per = await this.statsByCampaign(campaigns.map(c => c.id))

		return {
			funnel: await this.overallFunnel(),
			daily: [...byDay.values()],
			campaigns: campaigns.map(c => ({ ...c, funnel: per.get(c.id)! })),
		}
	}

	// ── отправка ─────────────────────────────────────────────────────────────

	/**
	 * Тик отправщика: раз в минуту смотрит, какому аккаунту пора писать.
	 *
	 * Темп считается на КАЖДЫЙ аккаунт: свой дневной счётчик, своя следующая
	 * минута, своя пауза после ошибки. Общая очередь на кампанию давала бы
	 * ровный поток с одного аккаунта, а это и есть картина рассылки.
	 */
	async sendTick(): Promise<number> {
		const now = new Date()
		const campaigns = await this.prisma.tgCampaign.findMany({
			where: { status: 'RUNNING' },
			include: { accounts: { include: { account: { include: { proxy: true } } } } },
		})

		let sent = 0
		for (const c of campaigns) {
			// Вне окна отправки не пишем: сообщение в четыре утра само по себе метка.
			const hour = now.getHours()
			if (hour < c.windowFrom || hour >= c.windowTo) continue

			const today = dayKey(now)
			// Норма каждого аккаунта на сегодня. Если задана цель дня, она
			// раскладывается по готовности; иначе у каждого свой общий потолок.
			const quota = await this.dailyQuota(c, today)

			for (const link of c.accounts) {
				if (link.pausedUntil && link.pausedUntil > now) continue
				if (link.nextSendAt && link.nextSendAt > now) continue

				const acc = link.account
				// PAUSED — ручная остановка: аккаунт не трогаем ничем.
				if (acc.status === 'BANNED' || acc.status === 'ERROR' || acc.status === 'PAUSED') continue
				// Аккаунт, отведённый только под прогрев, не рассылает: он сейчас
				// набирает историю, и холодные исходящие эту работу перечёркивают.
				if (acc.mode === 'WARM') continue
				// Занят прогревом — вернёмся на следующем тике.
				if (acc.busyUntil && acc.busyUntil > now) continue

				// Смена суток обнуляет счётчик.
				const sentToday = link.dayKey === today ? link.sentToday : 0
				if (sentToday >= (quota.get(acc.id) ?? 0)) continue

				// Здоровье аккаунта важнее плана: спамблок и второй PEER_FLOOD
				// закрывают исходящие независимо от того, что выставил человек.
				const allow = await this.warmup.allowanceFor(acc, 0)
				if (!allow.allowOutgoing) {
					await this.pauseAccount(link.id, 6 * 3600, allow.notes[0] ?? 'исходящие закрыты')
					continue
				}

				// Отсев тех, кому писать нечем, сетью не оплачивается, поэтому
				// пропускать их можно пачкой, не растягивая на сутки по одному.
				const SKIP_LIMIT = 25
				let verdict: SendVerdict = 'skipped'
				let done = false
				for (let skipped = 0; skipped <= SKIP_LIMIT; skipped++) {
					const recipient = await this.prisma.tgRecipient.findFirst({
						where: { campaignId: c.id, status: 'QUEUED' },
						orderBy: { createdAt: 'asc' },
					})
					if (!recipient) {
						// Очередь кончилась — кампания закрывается сама.
						await this.prisma.tgCampaign.update({
							where: { id: c.id },
							data: { status: 'DONE', finishedAt: now },
						})
						done = true
						break
					}

					// Захват адресата: без него два тика могли бы взять одного и того же.
					const claimed = await this.prisma.tgRecipient.updateMany({
						where: { id: recipient.id, status: 'QUEUED' },
						data: { status: 'SENT', accountId: acc.id, attempts: { increment: 1 } },
					})
					if (claimed.count !== 1) continue

					verdict = await this.sendOne(c, link, acc, recipient)
					if (verdict !== 'skipped') break
				}
				if (done) break
				if (verdict === 'sent') sent++

				await this.prisma.tgCampaignAccount.update({
					where: { id: link.id },
					data: {
						dayKey: today,
						// Счётчик растёт только за реально ушедшее сообщение. Иначе
						// сутки на мёртвом прокси съедали бы дневную норму впустую.
						sentToday: sentToday + (verdict === 'sent' ? 1 : 0),
						// Пауза между сообщениями нужна после отправки. После
						// неудачи паузу уже поставил sendOne, своей длины, а после
						// пропуска ждать нечего.
						...(verdict === 'sent'
							? {
									nextSendAt: new Date(
										now.getTime() +
											(c.minIntervalSec +
												Math.floor(Math.random() * Math.max(1, c.maxIntervalSec - c.minIntervalSec))) *
												1000,
									),
								}
							: {}),
					},
				})
			}
		}
		return sent
	}

	/**
	 * Сколько сообщений положено каждому аккаунту сегодня.
	 *
	 * Без цели дня — просто общий потолок каждому. С целью — она делится по
	 * готовности: прогретому больше, слабому меньше, закрытому ничего. Личный
	 * потолок при этом остаётся верхней границей и цель его не поднимает.
	 */
	async dailyQuota(campaign: any, today: string): Promise<Map<string, number>> {
		const links: any[] = campaign.accounts ?? []
		if (!campaign.dailyGoal) {
			return new Map(links.map(l => [l.accountId, campaign.perAccountPerDay]))
		}

		const rows = []
		for (const l of links) {
			const acc = l.account
			const dead = acc.status === 'BANNED' || acc.status === 'ERROR' || acc.status === 'PAUSED'
			const allow = dead ? null : await this.warmup.allowanceFor(acc, 0)
			// Уже отправленное сегодня из потолка не вычитаем: раскладка — это
			// план на сутки целиком, а не остаток. Иначе доля аккаунта менялась
			// бы после каждого сообщения.
			rows.push({
				id: acc.id,
				readiness: allow?.readiness ?? 0,
				canSend: !!allow?.allowOutgoing,
				cap: campaign.perAccountPerDay,
			})
		}
		return distributeDaily(campaign.dailyGoal, rows)
	}

	private async pauseAccount(linkId: string, seconds: number, why: string) {
		await this.prisma.tgCampaignAccount.update({
			where: { id: linkId },
			data: { pausedUntil: new Date(Date.now() + seconds * 1000), lastError: why.slice(0, 300) },
		})
	}

	/**
	 * Одна отправка. Три исхода, и различать их обязательно:
	 *   'sent'    — ушло, тратим дневную норму и выдерживаем паузу;
	 *   'skipped' — адресат не годится, сеть не трогали, можно сразу к следующему;
	 *   'failed'  — беда с аккаунтом или связью, норму не тратим, аккаунт на паузе.
	 */
	private async sendOne(campaign: any, link: any, account: any, recipient: any): Promise<SendVerdict> {
		// Не пишем тому, кому уже писали из другой кампании. Проверка при
		// вставке ловит не всё: списки могли пересечься уже после добавления,
		// пока эта кампания стояла в очереди.
		const key = recipient.username ?? recipient.phone
		if (key) {
			const already = await this.prisma.tgRecipient.findFirst({
				where: {
					id: { not: recipient.id },
					sentAt: { not: null },
					OR: [{ username: key }, { phone: key }],
				},
				select: { campaign: { select: { name: true } } },
			})
			if (already) {
				await this.prisma.tgRecipient.update({
					where: { id: recipient.id },
					data: {
						status: 'STOPPED', sentAt: null, accountId: null,
						error: `уже писали из кампании «${already.campaign.name}»`,
					},
				})
				return 'skipped'
			}
		}

		// Данных не хватает — не отправляем вовсе. Обезличенное «Здравствуйте»
		// сжигает адресата навсегда, а второго шанса написать не будет.
		const missing = missingPlaceholders(campaign.firstMessage, recipient)
		if (missing.length) {
			await this.prisma.tgRecipient.update({
				where: { id: recipient.id },
				data: {
					status: 'FAILED', sentAt: null, accountId: null,
					error: `не хватает данных для текста: ${missing.join(', ')}`,
				},
			})
			return 'skipped'
		}
		const text = fillTemplate(campaign.firstMessage, recipient)

		// Захват на время отправки: прогрев не должен подключиться тем же
		// аккаунтом, пока мы пишем.
		if (!(await this.warmup.claimAccount(account.id, 'send', 120))) {
			await this.prisma.tgRecipient.update({
				where: { id: recipient.id },
				data: { status: 'QUEUED', sentAt: null, accountId: null },
			})
			return 'skipped'
		}

		const opts = this.warmup.clientOptions(account)
		try {
			const { result, session } = await withClient(opts, async client => {
				const peer = await this.resolvePeer(client, recipient)
				const msg: any = await call(client, 'sendMessage', () => client.sendMessage(peer.entity, { message: text }))
				return { msgId: Number(msg?.id ?? 0), userId: peer.userId }
			})
			await this.warmup.persistSession(account.id, opts.session, session)

			await this.prisma.tgRecipient.update({
				where: { id: recipient.id },
				data: {
					status: 'SENT', sentAt: new Date(), sentMsgId: result.msgId || null,
					tgUserId: result.userId ?? recipient.tgUserId, error: null,
					lastSeenMsgId: result.msgId || 0,
				},
			})
			if (result.msgId) {
				await this.prisma.tgDialogMessage.create({
					data: { recipientId: recipient.id, tgId: result.msgId, out: true, text, date: new Date() },
				})
			}
			await this.prisma.tgAccount.update({
				where: { id: account.id },
				data: { actionsTotal: { increment: 1 }, lastCheckAt: new Date(), lastError: null },
			})
			return 'sent'
		} catch (e: any) {
			const failure = e instanceof TgError ? e.failure : classifyError(e)
			const code = hopelessReason(failure.message)

			if (code) {
				// Сервер сказал прямо: писать этому человеку нельзя.
				const blocking = code === 'USER_PRIVACY_RESTRICTED' || code === 'USER_IS_BLOCKED' || code === 'YOU_BLOCKED_USER'
				await this.prisma.tgRecipient.update({
					where: { id: recipient.id },
					data: {
						status: blocking ? 'BLOCKED' : 'FAILED',
						blockedAt: blocking ? new Date() : null,
						sentAt: null, error: REASON_RU[code] ?? code,
					},
				})
				// Сеть тронули, но виноват адресат, а не аккаунт: паузу не ставим.
				return 'skipped'
			}

			// Общая беда аккаунта: возвращаем адресата в очередь, аккаунт паузим.
			await this.prisma.tgRecipient.update({
				where: { id: recipient.id },
				data: { status: 'QUEUED', sentAt: null, accountId: null, error: failure.message.slice(0, 300) },
			})
			await this.warmup.applyFailure(account.id, failure)

			if (failure.kind === 'flood' && failure.seconds) {
				await this.pauseAccount(link.id, failure.seconds + 60, `FLOOD_WAIT ${failure.seconds} с`)
			} else if (failure.kind === 'peerFlood') {
				// Поведенческий вердикт: до конца суток этот аккаунт не пишет.
				await this.pauseAccount(link.id, 24 * 3600, 'PEER_FLOOD — отправка остановлена на сутки')
				await this.notifyAdmin(
					`⚠️ <b>PEER_FLOOD</b>\n\nАккаунт <b>${esc(account.label ?? account.id)}</b> получил спам-лимит ` +
						`в кампании «${esc(campaign.name)}». Отправка с него остановлена на сутки.`,
				)
			} else {
				await this.pauseAccount(link.id, 1800, failure.message)
			}
			return 'failed'
		} finally {
			await this.warmup.releaseAccount(account.id)
		}
	}

	/**
	 * Найти адресата.
	 *
	 * По юзернейму — обычный резолв. По телефону иначе: единственный способ
	 * написать на номер — сначала добавить его в контакты через importContacts.
	 * Это заметное действие со стороны Telegram, поэтому телефоны стоит
	 * использовать только когда юзернейма действительно нет.
	 */
	private async resolvePeer(client: any, r: any): Promise<{ entity: any; userId: string | null }> {
		if (r.username) {
			const res: any = await call(client, 'resolveUsername', () =>
				client.invoke(new Api.contacts.ResolveUsername({ username: r.username })),
			)
			const user = (res?.users ?? [])[0]
			return { entity: user ?? r.username, userId: user ? String(user.id) : null }
		}
		if (r.phone) {
			const res: any = await call(client, 'importContacts', () =>
				client.invoke(
					new Api.contacts.ImportContacts({
						contacts: [
							new Api.InputPhoneContact({
								clientId: bigInt(Date.now()),
								phone: r.phone,
								firstName: r.firstName || 'Контакт',
								lastName: r.lastName || '',
							}),
						],
					}),
				),
			)
			const user = (res?.users ?? [])[0]
			if (!user) throw new TgError({ kind: 'other', message: 'PHONE_NUMBER_INVALID' })
			return { entity: user, userId: String(user.id) }
		}
		throw new TgError({ kind: 'other', message: 'PEER_ID_INVALID' })
	}

	// ── опрос ответов ────────────────────────────────────────────────────────

	/**
	 * Тик опросника: что случилось с отправленным.
	 *
	 * Один вызов getDialogs на аккаунт даёт сразу всё: readOutboxMaxId говорит,
	 * докуда собеседник прочитал НАШИ сообщения, topMessage — появилось ли в
	 * переписке что-то новое. Спрашивать про каждого адресата отдельно было бы
	 * в сотни раз больше запросов на ровном месте.
	 *
	 * Прочитанным входящее НЕ помечаем: галочка «прочитано» без ответа хуже,
	 * чем непрочитанное сообщение. Отвечает человек, из бота.
	 */
	async pollTick(filter?: PollFilter): Promise<PollResult> {
		// Опросы выстраиваются в очередь: расписание и кнопка «Синхронизировать»
		// зовут одно и то же, а два одновременных захода к одному аккаунту дали
		// бы два соединения с одной сессии — Telegram это видит.
		const run = this.chain.then(() => this.doPoll(filter), () => this.doPoll(filter))
		this.chain = run.then(
			() => undefined,
			() => undefined,
		)
		return run
	}

	private async doPoll(filter?: PollFilter): Promise<PollResult> {
		const pending = await this.prisma.tgRecipient.findMany({
			where: {
				status: { in: ['SENT', 'READ', 'REPLIED', 'SECOND_SENT'] },
				accountId: { not: null },
				...(filter?.recipientId ? { id: filter.recipientId } : {}),
				...(filter?.campaignId ? { campaignId: filter.campaignId } : {}),
			},
			include: { campaign: { select: { id: true, name: true } } },
		})
		if (!pending.length) return { accounts: 0, checked: 0, changed: 0, replies: 0, failed: 0, skipped: 0 }

		const byAccount = new Map<string, typeof pending>()
		for (const r of pending) {
			const list = byAccount.get(r.accountId!)
			if (list) list.push(r)
			else byAccount.set(r.accountId!, [r])
		}

		let changed = 0
		let replies = 0
		let failed = 0
		let skipped = 0

		// Аккаунты опрашиваются пачкой: у каждого своё соединение и свой прокси,
		// а последовательно один мёртвый прокси съедает двадцать секунд и
		// задерживает всех остальных. При нажатии кнопки это особенно заметно —
		// запрос висит, пока не переберём весь пул.
		const CONCURRENCY = 4
		const deadline = filter?.deadlineMs ? Date.now() + filter.deadlineMs : Infinity

		const queue = [...byAccount.entries()]
		let inFlight = 0
		const worker = async () => {
			for (;;) {
				const item = queue.shift()
				if (!item) return
				if (Date.now() > deadline) {
					queue.length = 0
					return
				}
				inFlight++
				try {
					await one(item[0], item[1])
				} finally {
					inFlight--
				}
			}
		}

		const one = async (accountId: string, list: typeof pending) => {
			const account = await this.prisma.tgAccount.findUnique({
				where: { id: accountId },
				include: { proxy: true },
			})
			if (!account || account.status === 'BANNED') return
			// Занят прогревом — пропускаем, ответы подождут до следующего тика.
			if (account.busyUntil && account.busyUntil > new Date()) {
				skipped += list.length
				return
			}
			if (!(await this.warmup.claimAccount(account.id, 'poll', 120))) {
				skipped += list.length
				return
			}

			const opts = this.warmup.clientOptions(account)
			try {
				const { result, session } = await withClient(opts, async client => {
					const dialogs: any = await call(client, 'getDialogs', () => client.getDialogs({ limit: 100 }))
					const out: Array<{ recipient: any; readTo: number; top: number; entity: any }> = []
					for (const d of dialogs ?? []) {
						if (!d?.isUser || !d?.entity) continue
						const uid = String(d.entity.id)
						const uname = String(d.entity.username ?? '').toLowerCase()
						const r = list.find(x => (x.tgUserId && x.tgUserId === uid) || (x.username && x.username === uname))
						if (!r) continue
						out.push({
							recipient: r,
							readTo: Number(d.dialog?.readOutboxMaxId ?? 0),
							top: Number(d.dialog?.topMessage ?? 0),
							entity: d.entity,
						})
					}
					// История тянется только там, где что-то изменилось.
					const fetched: Array<{ id: string; messages: any[] }> = []
					for (const item of out) {
						if (item.top <= item.recipient.lastSeenMsgId) continue
						const msgs: any = await call(client, 'getMessages', () =>
							client.getMessages(item.entity, { limit: 40, minId: item.recipient.lastSeenMsgId }),
						)
						fetched.push({ id: item.recipient.id, messages: msgs ?? [] })
					}
					return { out, fetched }
				})
				await this.warmup.persistSession(account.id, opts.session, session)

				const history = new Map(result.fetched.map(f => [f.id, f.messages]))
				for (const item of result.out) {
					const before = !!item.recipient.repliedAt
					if (await this.applyDialogState(item, history.get(item.recipient.id) ?? [], account)) {
						changed++
						if (!before) {
							const after = await this.prisma.tgRecipient.findUnique({
								where: { id: item.recipient.id },
								select: { repliedAt: true },
							})
							if (after?.repliedAt) replies++
						}
					}
				}
			} catch (e: any) {
				failed++
				const failure = e instanceof TgError ? e.failure : classifyError(e)
				await this.warmup.applyFailure(account.id, failure)
			} finally {
				await this.warmup.releaseAccount(account.id)
			}
		}

		const all = Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker))

		if (deadline === Infinity) {
			await all
		} else {
			// Проверки «не пора ли остановиться» мало: она не даёт НАЧАТЬ новый
			// аккаунт, но уже начатый идёт до своего таймаута, и на мёртвом
			// прокси это ещё двадцать секунд сверху. Поэтому по истечении срока
			// просто отвечаем тем, что успели. Начатое доработает в фоне и ляжет
			// в базу — следующая синхронизация это покажет.
			let ring: NodeJS.Timeout
			const timer = new Promise<void>(r => {
				ring = setTimeout(r, Math.max(1000, deadline - Date.now()))
			})
			await Promise.race([all.then(() => clearTimeout(ring)), timer])
			skipped = queue.length + inFlight
			// Фоновые ошибки не должны всплыть как необработанный отказ.
			all.catch(() => {})
		}
		return { accounts: byAccount.size, checked: pending.length, changed, replies, failed, skipped }
	}

	/** Разложить состояние одного диалога: прочтение, новые сообщения, ответ. */
	private async applyDialogState(
		item: { recipient: any; readTo: number; top: number },
		messages: any[],
		account: any,
	): Promise<boolean> {
		const r = item.recipient
		const patch: any = {}

		// Прочтение: собеседник прочитал наше сообщение, если его id не больше
		// границы прочитанного исходящего.
		if (!r.readAt && r.sentMsgId && item.readTo >= r.sentMsgId) patch.readAt = new Date()

		let incoming: any[] = []
		if (messages.length) {
			const rows = messages
				.filter(m => m?.id && (m.message || m.out !== undefined))
				.map(m => ({
					recipientId: r.id,
					tgId: Number(m.id),
					out: !!m.out,
					text: String(m.message ?? '[вложение без текста]'),
					date: m.date ? new Date(Number(m.date) * 1000) : new Date(),
				}))
			if (rows.length) {
				// skipDuplicates: одно и то же сообщение может прийти в двух опросах.
				await this.prisma.tgDialogMessage.createMany({ data: rows, skipDuplicates: true })
				patch.lastSeenMsgId = Math.max(r.lastSeenMsgId, ...rows.map(x => x.tgId))
			}
			incoming = rows.filter(x => !x.out)
		}

		if (incoming.length && !r.repliedAt) {
			patch.repliedAt = new Date()
			// Ответ означает и прочтение, даже если галочка ещё не дошла.
			if (!r.readAt && !patch.readAt) patch.readAt = new Date()
		}

		if (!Object.keys(patch).length) return false

		// Статус — самая дальняя достигнутая ступень, не последнее событие.
		const replied = r.repliedAt || patch.repliedAt
		const read = r.readAt || patch.readAt
		patch.status = r.secondSentAt ? 'SECOND_SENT' : replied ? 'REPLIED' : read ? 'READ' : r.status

		await this.prisma.tgRecipient.update({ where: { id: r.id }, data: patch })

		if (incoming.length && !r.repliedAt) {
			const who = [r.firstName, r.lastName].filter(Boolean).join(' ') || (r.username ? '@' + r.username : r.phone)
			// Показываем ВСЕ пришедшие реплики, а не последнюю: человек часто
			// пишет «Здравствуйте» и следом суть, и по одной последней строке
			// не понять, о чём разговор.
			const body = incoming
				.sort((x, y) => x.tgId - y.tgId)
				.map(m => esc(m.text).slice(0, 700))
				.join('\n\n')
				.slice(0, 2500)
			await this.notifyAdmin(
				`💬 <b>Ответили в рассылке</b>\n\n` +
					`<b>${esc(who ?? '')}</b>${r.domain ? ` · ${esc(r.domain)}` : ''}\n` +
					`Кампания: ${esc(r.campaign?.name ?? '')}\n` +
					`Аккаунт: ${esc(account.label ?? account.id)}\n\n` +
					`<blockquote>${body}</blockquote>`,
			)
		}
		return true
	}

	// ── переписка и второе сообщение ─────────────────────────────────────────

	async dialog(recipientId: string) {
		const r = await this.prisma.tgRecipient.findUnique({
			where: { id: recipientId },
			include: {
				campaign: { select: { id: true, name: true, secondMessage: true } },
				account: { select: { id: true, label: true, username: true, status: true } },
				// По id, а не по дате: у Telegram дата с точностью до секунды, и
				// сообщения одной секунды выстраивались бы как попало. Внутри
				// личной переписки id строго возрастают.
				messages: { orderBy: { tgId: 'asc' } },
			},
		})
		if (!r) throw new NotFoundException('Адресат не найден')
		return {
			id: r.id,
			who: [r.firstName, r.middleName, r.lastName].filter(Boolean).join(' ') || null,
			username: r.username, phone: r.phone, domain: r.domain, company: r.company,
			status: r.status,
			sentAt: r.sentAt, readAt: r.readAt, repliedAt: r.repliedAt,
			secondSentAt: r.secondSentAt, blockedAt: r.blockedAt, error: r.error,
			campaign: r.campaign, account: r.account,
			secondPreview: r.campaign.secondMessage ? fillTemplate(r.campaign.secondMessage, r) : null,
			messages: r.messages.map(m => ({ id: m.id, out: m.out, text: m.text, date: m.date })),
		}
	}

	/**
	 * Написать адресату — любой текст, в любой момент.
	 *
	 * Автоматом уходит только ПЕРВОЕ касание: его текст известен заранее и
	 * одинаков для всех. Дальше это разговор с живым человеком, и ведёт его
	 * человек. Автоответчик, шлющий заготовку на любую реплику, включая
	 * «не интересно», портит ровно те диалоги, ради которых всё делалось.
	 *
	 * Первое отправленное вручную сообщение засчитывается в воронку как
	 * «второе касание»: именно этот шаг там и меряется. Дальнейшие — уже
	 * переписка, и в воронке им места нет.
	 */
	async sendManual(recipientId: string, text: string) {
		const body = String(text ?? '').trim()
		if (!body) throw new BadRequestException('Пустое сообщение')
		if (body.length > 4000) throw new BadRequestException('Сообщение длиннее 4000 символов Telegram не примет')

		const r = await this.prisma.tgRecipient.findUnique({
			where: { id: recipientId },
			include: { campaign: true, account: { include: { proxy: true } } },
		})
		if (!r) throw new NotFoundException('Адресат не найден')
		if (!r.account) throw new BadRequestException('Не известно, с какого аккаунта шла переписка')
		if (r.account.status === 'BANNED') throw new BadRequestException('Аккаунт заблокирован — с него уже не написать')

		if (!(await this.warmup.claimAccount(r.account.id, 'send', 120))) {
			throw new BadRequestException('Аккаунт сейчас занят прогревом, попробуйте через минуту')
		}
		const opts = this.warmup.clientOptions(r.account)
		try {
			const { result, session } = await withClient(opts, async client => {
				const peer = await this.resolvePeer(client, r)
				const msg: any = await call(client, 'sendMessage', () => client.sendMessage(peer.entity, { message: body }))
				return Number(msg?.id ?? 0)
			})
			await this.warmup.persistSession(r.account.id, opts.session, session)

			await this.prisma.tgRecipient.update({
				where: { id: r.id },
				data: {
					error: null,
					...(r.secondSentAt ? {} : { secondSentAt: new Date(), status: 'SECOND_SENT' as const }),
					...(result ? { lastSeenMsgId: Math.max(r.lastSeenMsgId, result) } : {}),
				},
			})
			if (result) {
				await this.prisma.tgDialogMessage.createMany({
					data: [{ recipientId: r.id, tgId: result, out: true, text: body, date: new Date() }],
					skipDuplicates: true,
				})
			}
			return { ok: true, text: body }
		} catch (e: any) {
			const failure = e instanceof TgError ? e.failure : classifyError(e)
			await this.warmup.applyFailure(r.account.id, failure)
			throw new BadRequestException(`Не отправилось: ${failure.message}`)
		} finally {
			await this.warmup.releaseAccount(r.account.id)
		}
	}

	/**
	 * Когда каждому уйдёт сообщение и когда рассылка кончится.
	 *
	 * Считается симуляцией того же порядка, по которому работает отправщик:
	 * очередь по дате добавления, аккаунт берёт по одному, между сообщениями
	 * пауза, дневная норма и окно. Точного времени тут быть не может — паузы
	 * случайные, аккаунт может уйти в FLOOD_WAIT, — поэтому берётся средняя
	 * пауза, и в интерфейсе это подписано как «примерно».
	 *
	 * Считаем только тех, кому реально напишем: адресат без данных для текста
	 * будет пропущен, и обещать ему время нельзя.
	 */
	async forecast(campaignId: string) {
		const c = await this.prisma.tgCampaign.findUnique({
			where: { id: campaignId },
			include: { accounts: { include: { account: true } } },
		})
		if (!c) return { times: {} as Record<string, PlannedSend>, finishAt: null as string | null, skipped: 0, today: 0 }

		const queued = await this.prisma.tgRecipient.findMany({
			where: { campaignId, status: 'QUEUED' },
			orderBy: { createdAt: 'asc' },
			select: { id: true, firstName: true, middleName: true, lastName: true, company: true, domain: true },
		})
		const willWrite = queued.filter(r => missingPlaceholders(c.firstMessage, r).length === 0)

		const now = new Date()
		const today = dayKey(now)
		const quota = await this.dailyQuota(c, today)
		const avgPause = ((c.minIntervalSec + c.maxIntervalSec) / 2) * 1000

		// Начальное состояние каждого аккаунта: когда освободится и сколько
		// сообщений ему осталось сегодня.
		type Slot = { id: string; label: string | null; tgUserId: string | null; cursor: number; left: number; day: number }
		const slots: Slot[] = []
		for (const link of c.accounts) {
			const acc = link.account
			if (acc.status === 'BANNED' || acc.status === 'ERROR' || acc.status === 'PAUSED') continue
			const allow = await this.warmup.allowanceFor(acc, 0)
			if (!allow.allowOutgoing) continue

			const cap = quota.get(acc.id) ?? 0
			const sent = link.dayKey === today ? link.sentToday : 0
			const from = Math.max(
				now.getTime(),
				link.nextSendAt?.getTime() ?? 0,
				link.pausedUntil?.getTime() ?? 0,
				windowStart(now, c.windowFrom, 0).getTime(),
			)
			slots.push({
				id: acc.id, label: acc.label, tgUserId: acc.tgUserId,
				cursor: from, left: Math.max(0, cap - sent), day: 0,
			})
		}

		const times: Record<string, PlannedSend> = {}
		if (!slots.length || !willWrite.length) {
			return { times, finishAt: null, skipped: queued.length - willWrite.length, today: 0 }
		}

		let last = 0
		for (const r of willWrite) {
			// Берём аккаунт, который освободится раньше всех.
			let slot = slots[0]
			for (const s of slots) if (s.cursor < slot.cursor) slot = s

			// Норма на сегодня выбрана или окно кончилось — переносим на завтра.
			const dayEnd = windowStart(now, c.windowTo, slot.day).getTime()
			if (slot.left <= 0 || slot.cursor >= dayEnd) {
				slot.day++
				slot.cursor = windowStart(now, c.windowFrom, slot.day).getTime()
				// Норма следующего дня та же, что сегодня: состав пула и готовность
				// за сутки заметно не меняются, а гадать точнее смысла нет.
				slot.left = quota.get(slot.id) ?? c.perAccountPerDay
			}

			times[r.id] = {
				at: new Date(slot.cursor).toISOString(),
				accountId: slot.id,
				accountLabel: slot.label,
				tgUserId: slot.tgUserId,
			}
			last = Math.max(last, slot.cursor)
			slot.cursor += avgPause
			slot.left--
		}

		// Сколько из очереди уйдёт сегодня — главная цифра при запуске «на сегодня».
		const endOfToday = windowStart(now, c.windowTo, 0).getTime()
		const goesToday = Object.values(times).filter(t => new Date(t.at).getTime() < endOfToday).length

		return {
			times,
			finishAt: last ? new Date(last).toISOString() : null,
			skipped: queued.length - willWrite.length,
			today: goesToday,
		}
	}

	/** Кампания целиком: настройки, аккаунты, воронка. */
	async card(id: string) {
		const c = await this.prisma.tgCampaign.findUnique({
			where: { id },
			include: { accounts: { include: { account: true } } },
		})
		if (!c) throw new NotFoundException('Кампания не найдена')
		const funnel = (await this.statsByCampaign([id])).get(id)!

		const quota = await this.dailyQuota(c, dayKey(new Date()))
		// Готовность каждого аккаунта показываем прямо здесь: выбирая, с кого
		// рассылать, надо видеть, кому Telegram уже говорил сбавить.
		const accounts = []
		for (const link of c.accounts) {
			const allow = await this.warmup.allowanceFor(link.account, 0)
			accounts.push({
				id: link.account.id,
				label: link.account.label,
				avatar: link.account.avatar,
				status: link.account.status,
				mode: link.account.mode,
				quotaToday: quota.get(link.account.id) ?? 0,
				readiness: allow.readiness,
				allowOutgoing: allow.allowOutgoing,
				notes: allow.notes,
				sentToday: link.dayKey === dayKey(new Date()) ? link.sentToday : 0,
				nextSendAt: link.nextSendAt,
				pausedUntil: link.pausedUntil,
				lastError: link.lastError,
			})
		}

		const plan = await this.forecast(id)
		const readiness = await this.accountsReadiness(id)
		return {
			id: c.id, name: c.name, status: c.status,
			// Кто из аккаунтов ещё не готов к холодным исходящим и что доделать.
			notWarm: readiness.filter(r => !r.coldReady),
			today: plan.today,
			firstMessage: c.firstMessage, secondMessage: c.secondMessage,
			dailyGoal: c.dailyGoal,
			// Когда уйдёт последнее сообщение очереди. Оценка: паузы случайные.
			finishAt: plan.finishAt,
			preflight: await this.preflight(id, c.firstMessage),
			perAccountPerDay: c.perAccountPerDay,
			minIntervalSec: c.minIntervalSec, maxIntervalSec: c.maxIntervalSec,
			windowFrom: c.windowFrom, windowTo: c.windowTo,
			createdAt: c.createdAt, startedAt: c.startedAt, finishedAt: c.finishedAt,
			accounts, funnel,
		}
	}

	/**
	 * Предполётная проверка: скольким из очереди мы физически не сможем написать.
	 *
	 * Показывается ДО запуска, а не выясняется по ходу: увидеть «из 300 адресатов
	 * 180 без имени» лучше заранее, чем найти их потом в «Не дошло».
	 */
	async preflight(campaignId: string, template: string) {
		const queued = await this.prisma.tgRecipient.findMany({
			where: { campaignId, status: 'QUEUED' },
			select: { firstName: true, middleName: true, lastName: true, company: true, domain: true },
		})
		const byField = new Map<string, number>()
		let ready = 0
		for (const r of queued) {
			const missing = missingPlaceholders(template, r)
			if (!missing.length) {
				ready++
				continue
			}
			for (const m of missing) byField.set(m, (byField.get(m) ?? 0) + 1)
		}
		return {
			queued: queued.length,
			ready,
			blocked: queued.length - ready,
			missing: [...byField.entries()].map(([field, count]) => ({ field, count })).sort((a, b) => b.count - a.count),
		}
	}

	/**
	 * Пробная отправка: тот же текст, тот же аккаунт, но адресат — вы сами.
	 *
	 * Единственный способ проверить рассылку целиком, не тратя чужой контакт:
	 * первое сообщение незнакомому человеку отправляется ровно один раз, и
	 * «посмотреть, как выглядит» на нём нельзя.
	 */
	async testSend(campaignId: string, accountId: string, target: string, recipientId?: string) {
		const c = await this.prisma.tgCampaign.findUnique({ where: { id: campaignId } })
		if (!c) throw new NotFoundException('Кампания не найдена')
		const account = await this.prisma.tgAccount.findUnique({ where: { id: accountId }, include: { proxy: true } })
		if (!account) throw new NotFoundException('Аккаунт не найден')

		const handle = String(target ?? '').trim().replace(/^https?:\/\/t\.me\//i, '').replace(/^@/, '')
		if (!/^[a-z0-9_]{4,32}$/i.test(handle)) {
			throw new BadRequestException('Укажите юзернейм получателя, например @ваш_аккаунт')
		}

		// Текст берём с данными настоящего адресата, если он есть: проверять
		// шаблон на выдуманном «Иване Ивановиче» бессмысленно.
		const sample = recipientId
			? await this.prisma.tgRecipient.findUnique({ where: { id: recipientId } })
			: await this.prisma.tgRecipient.findFirst({ where: { campaignId, status: 'QUEUED' } })
		const data = sample ?? { firstName: 'Иван', middleName: 'Петрович', lastName: 'Сидоров', company: 'ООО «Пример»', domain: 'example.ru' }
		const text = fillTemplate(c.firstMessage, data as any)

		if (!(await this.warmup.claimAccount(account.id, 'send', 120))) {
			throw new BadRequestException('Аккаунт сейчас занят прогревом, попробуйте через минуту')
		}
		const opts = this.warmup.clientOptions(account)
		try {
			const { session } = await withClient(opts, async client => {
				const peer = await this.resolvePeer(client, { username: handle.toLowerCase() })
				await call(client, 'sendMessage', () => client.sendMessage(peer.entity, { message: text }))
				return null
			})
			await this.warmup.persistSession(account.id, opts.session, session)
			return { ok: true, text, sentTo: '@' + handle, usedRealData: !!sample }
		} catch (e: any) {
			const failure = e instanceof TgError ? e.failure : classifyError(e)
			await this.warmup.applyFailure(account.id, failure)
			throw new BadRequestException(`Не отправилось: ${failure.message}`)
		} finally {
			await this.warmup.releaseAccount(account.id)
		}
	}

	/** Список адресатов кампании для таблицы. */
	async recipients(campaignId: string, status?: string, limit = 200) {
		const rows = await this.prisma.tgRecipient.findMany({
			where: { campaignId, ...recipientFilter(status) },
			orderBy: [{ repliedAt: 'desc' }, { sentAt: 'desc' }, { createdAt: 'asc' }],
			take: Math.max(1, Math.min(1000, limit)),
			include: {
				account: { select: { label: true } },
				_count: { select: { messages: true } },
			},
		})
		// Прогноз считаем один раз на список, а не на каждую строку.
		const { times } = await this.forecast(campaignId)
		return rows.map(r => ({
			id: r.id,
			who: [r.firstName, r.middleName, r.lastName].filter(Boolean).join(' ') || null,
			username: r.username, phone: r.phone, domain: r.domain,
			status: r.status,
			plannedAt: times[r.id]?.at ?? null,
			plannedFrom: times[r.id]
				? { label: times[r.id].accountLabel, tgUserId: times[r.id].tgUserId }
				: null,
			sentAt: r.sentAt, readAt: r.readAt, repliedAt: r.repliedAt,
			secondSentAt: r.secondSentAt, error: r.error,
			account: r.account?.label ?? null,
			messages: r._count.messages,
		}))
	}

	private async notifyAdmin(html: string) {
		try {
			await this.telegram.sendAdminNotification(html)
		} catch (e: any) {
			this.logger.warn(`Уведомление админу не ушло: ${e?.message ?? e}`)
		}
	}
}

/** Экранирование под parse_mode: HTML в боте. */
function esc(s: string): string {
	return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

}
