import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { Api } from 'teleproto'
import bigInt from 'big-integer'
import { PrismaService } from '../prisma/prisma.service'
import { TelegramService } from '../telegram/telegram.service'
import { TgWarmupService } from './tg-warmup.service'
import { call, classifyError, TgError, withClient } from './tg-client'
import { fillTemplate, missingPlaceholders } from './campaign-text'
import { FIRST_MESSAGE, SECOND_MESSAGE } from './campaign-preset'
import {
	buildOutreachMessage, MESSAGE_POSITION_MAX, MESSAGE_POSITION_MIN,
	type MessageCompetitor, type MessageKeyword,
} from '../outreach/outreach-message'
import { distributeDaily } from './warmup-plan'
import { planQueue, startCursor, windowStart, type PlanSlot } from './campaign-plan'
import { mskAt, mskDayKey, mskHour } from './msk'
import { mediaCaption, mediaOf, mimeFor, worthDownloading } from './media'

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
	const dayStart = mskAt(now, fromHour, 0)
	const dayEnd = mskAt(now, toHour, 0)

	// Хвост окна короче получаса — не втискиваемся, начинаем завтра.
	const earliest = Math.max(dayStart.getTime(), now.getTime())
	if (earliest > dayEnd.getTime() - 30 * 60_000) {
		const t = mskAt(now, fromHour, 1)
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

/**
 * Дата вида «2026-09-06» в полночь по местному времени.
 *
 * Именно по местному, а не в UTC: человек выбирает день в календаре, глядя на
 * свои часы, и «шестое» должно значить шестое у него, а не сдвинутое на
 * часовой пояс сервера.
 */
function parseDay(value?: string | null): Date | null {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? '').trim())
	if (!m) return null
	// Полночь ЭТОГО дня по Москве: «шестое» должно значить шестое у владельца,
	// а не сутки, сдвинутые часовым поясом сервера.
	const utcMidnight = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - 180 * 60_000
	const d = new Date(utcMidnight)
	return Number.isNaN(d.getTime()) ? null : d
}

/** «ГГГГ-ММ-ДД» по местному времени. ISO тут не годится: со сдвигом часового
 * пояса полночь шестого превращается в пятое, и день на экране уезжает. */
function dayString(d: Date | null | undefined): string | null {
	return d ? dayKey(d) : null
}

/** Полночь указанных суток. */
function startOfDay(d: Date): Date {
	return mskAt(d, 0, 0)
}

/**
 * Ключ суток для дневных счётчиков — по Москве.
 *
 * Иначе норма аккаунта обнулялась бы в три часа ночи по московскому времени,
 * посреди окна отправки.
 */
function dayKey(d: Date): string {
	return mskDayKey(d)
}

/**
 * Что записано у лида в поле «телеграм».
 *
 * Поле заполняет менеджер руками, и туда попадает всё подряд: юзернейм с
 * собакой и без, ссылка t.me, телефон (тоже с собакой — «@+79001234567»), а
 * иногда и фраза вроде «нет тега, но есть контакт тг». Раньше принимался
 * только юзернейм, и каждый третий живой лид молча отбрасывался, хотя по
 * телефону Telegram пишет не хуже: адресат добавляется в контакты и получает
 * сообщение так же.
 *
 * Телефон нормализуем как при добавлении списком — только цифры, без плюса.
 */
function parseContact(raw: string | null | undefined): { username: string; phone: null } | { username: null; phone: string } | null {
	const cleaned = String(raw ?? '')
		.trim()
		.replace(/^https?:\/\/(t\.me|telegram\.me)\//i, '')
		.replace(/^@/, '')
		.trim()
	if (!cleaned) return null

	const digits = cleaned.replace(/[\s()+-]/g, '')
	// Телефон: только цифры и 10-15 знаков. Короче — это не номер, длиннее тоже.
	if (/^\d{10,15}$/.test(digits)) return { username: null, phone: digits }
	if (/^[a-z0-9_]{4,32}$/i.test(cleaned)) return { username: cleaned.toLowerCase(), phone: null }
	return null
}

/**
 * Можно ли вообще принуждать этот аккаунт к отправке.
 *
 * Флаг «рассылать без прогрева» снимает НАШУ осторожность: низкую готовность,
 * первые дни только на чтение, пустой профиль. Это оценки, и владелец вправе
 * их отменить — аккаунты его.
 *
 * Чего флаг не отменяет: спамблок и второй PEER_FLOOD. Это не мнение, а ответ
 * Telegram. Под спамблоком сообщение просто не дойдёт до человека, а попытки
 * писать после второго PEER_FLOOD добивают аккаунт окончательно. Разрешить это
 * значило бы не «дать выбор», а молча тратить аккаунты на пустоту.
 */
function forceable(acc: any): { ok: boolean; why?: string } {
	const spam = (acc?.probe as any)?.spamBlock
	if (spam === 'permanent') return { ok: false, why: 'вечный спамблок — сообщения не дойдут' }
	if (spam === 'temporary') return { ok: false, why: 'временный спамблок — сообщения не дойдут' }
	if ((acc?.peerFloods ?? 0) >= 2) return { ok: false, why: 'дважды PEER_FLOOD — писать нельзя даже принудительно' }
	return { ok: true }
}

/**
 * Разрешена ли отправка с аккаунта прямо сейчас.
 *
 * Либо он дорос сам, либо владелец поставил флаг и Telegram не против.
 */
function maySend(acc: any, allow: { allowOutgoing: boolean } | null): boolean {
	if (allow?.allowOutgoing) return true
	return !!acc?.forceSend && forceable(acc).ok
}

/**
 * Стадия разговора — то, докуда дошли, а не что случилось.
 *
 * READ и REPLIED остаются в «1 сообщение»: прочтение и ответ это события
 * внутри стадии, а не следующий шаг. Шаг делаем мы, отправив второе.
 */
const STAGE_STATUS: Record<string, string[]> = {
	queued: ['QUEUED'],
	first: ['SENT', 'READ', 'REPLIED'],
	second: ['SECOND_SENT'],
	problem: ['BLOCKED', 'FAILED', 'STOPPED'],
}

function stageOf(status: string): string {
	for (const [stage, list] of Object.entries(STAGE_STATUS)) if (list.includes(status)) return stage
	return 'problem'
}

/** Причины, по которым писать этому человеку нельзя и повторять бессмысленно. */
const KEY_DAY_REPORT = 'tg_outreach_day_report'

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
			where: { archivedAt: null },
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

	/**
	 * Новая кампания. Текст берётся из кода, руками его не вводят.
	 *
	 * Параметры firstMessage и secondMessage оставлены: их присылает импорт
	 * старых списков, и запрещать это незачем. Но по умолчанию — заготовка из
	 * campaign-preset.ts, и именно она уходит при нажатии кнопки.
	 */
	async create(body?: { name?: string; firstMessage?: string; secondMessage?: string }) {
		return this.prisma.tgCampaign.create({
			data: {
				name: body?.name?.trim() || new Date().toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }),
				firstMessage: body?.firstMessage?.trim() || FIRST_MESSAGE,
				secondMessage: body?.secondMessage?.trim() || SECOND_MESSAGE,
			},
			select: { id: true },
		})
	}

	/** Перезалить в кампанию заготовленный текст из кода. */
	async resetText(id: string) {
		await this.prisma.tgCampaign.update({
			where: { id },
			data: { firstMessage: FIRST_MESSAGE, secondMessage: SECOND_MESSAGE },
		})
		return { ok: true }
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
		if (body?.sendDate !== undefined) {
			data.sendDate = body.sendDate ? parseDay(body.sendDate) : null
			if (body.sendDate && !data.sendDate) throw new BadRequestException('День отправки: ожидается дата вида 2026-09-06')
		}
		if (!data.name) delete data.name
		if (!data.firstMessage) delete data.firstMessage
		await this.prisma.tgCampaign.update({ where: { id }, data })

		// Окно, паузы и нормы задают само расписание. Сохранить их и оставить
		// прежний план — значит показывать календарь по старым настройкам.
		const affectsPlan = ['perAccountPerDay', 'minIntervalSec', 'maxIntervalSec', 'windowFrom', 'windowTo', 'dailyGoal', 'sendDate']
		if (affectsPlan.some(k => data[k] !== undefined)) await this.buildSchedule(id)
		return { ok: true }
	}

	/**
	 * Удалить рассылку.
	 *
	 * Неотправленных выбрасываем: им уже не напишут, а держать их в мёртвой
	 * кампании нельзя — при наборе новой отсеивается всякий, кто стоит в списке
	 * любой другой, и они оказались бы заперты навсегда.
	 *
	 * Отправленных не трогаем. Переписка с живым человеком — это не «данные
	 * кампании», это разговор, который идёт; удалить его вместе со строкой в
	 * списке было бы дико. Поэтому когда с рассылки уже писали, строку не
	 * сносим, а прячем: у TgRecipient каскад на кампанию, и удаление забрало бы
	 * с собой всю переписку и всю статистику.
	 *
	 * Если не писали никому — сносим целиком, прятать нечего.
	 */
	async remove(id: string) {
		const c = await this.prisma.tgCampaign.findUnique({ where: { id }, select: { id: true } })
		if (!c) throw new NotFoundException('Кампания не найдена')

		const dropped = await this.prisma.tgRecipient.deleteMany({
			where: { campaignId: id, sentAt: null, secondSentAt: null },
		})
		const kept = await this.prisma.tgRecipient.count({ where: { campaignId: id } })

		if (!kept) {
			await this.prisma.tgCampaign.delete({ where: { id } })
			return { ok: true, mode: 'deleted' as const, dropped: dropped.count, kept: 0 }
		}

		await this.prisma.tgCampaign.update({
			where: { id },
			data: { status: 'DONE', finishedAt: new Date(), archivedAt: new Date() },
		})
		return { ok: true, mode: 'archived' as const, dropped: dropped.count, kept }
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
		if (status === 'RUNNING') {
			// Порядок важен: scheduleStart раскидывает ПЕРВЫЙ выход каждого
			// аккаунта по случайной минуте окна, и планировщик отсчитывает от
			// этих минут. Соберись план раньше — все стартовали бы разом.
			const schedule = await this.scheduleStart(id)
			return { ok: true, schedule, plan: await this.buildSchedule(id) }
		}
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
		const res = await this.insertRecipients(campaignId, rows)
		if (res.added) await this.buildSchedule(campaignId)
		return { ...res, rejected }
	}

	/**
	 * Забрать адресатов из базы лидов.
	 *
	 * Только те, у кого телеграм проставлен РУКАМИ (telegramManual): спарсенные
	 * с сайта контакты — это чаще всего общий канал компании, а не человек.
	 */
	async addRecipientsFromLeads(campaignId: string, limit = 200) {
		// Берём с запасом: часть отсеется как «уже писали» или «кривой контакт»,
		// и без запаса «дай двадцать» превращалось бы в три.
		const want = Math.max(1, Math.min(1000, limit))
		const leads = await this.prisma.outreachLead.findMany({
			where: {
				telegramManual: true,
				telegram: { not: null },
				// Лиды из дев-сида в рассылку не берём. Их юзернеймы выдуманы, а
				// пространство имён в Telegram настоящее: один такой контакт уже
				// оказался живым человеком, и ему ушло письмо с чужим именем.
				//
				// Условие развёрнуто через OR намеренно. Короткое
				// `NOT: { notes: { contains: ... } }` превращается в SQL
				// `NOT (notes LIKE ...)`, а для NULL это не «истина», а NULL —
				// и строка отсеивается. У живых лидов заметка почти всегда
				// пустая, так что защита от сида выбрасывала ровно тех, кого
				// должна была пропускать: всю базу до последнего лида.
				OR: [{ notes: null }, { NOT: { notes: { contains: 'дев-сид' } } }],
			},
			select: {
				id: true, telegram: true, firstName: true, middleName: true, lastName: true,
				companyName: true, domain: true,
			},
			orderBy: { createdAt: 'desc' },
			take: want * 5,
		})

		let unusable = 0
		const rows = leads
			.map(l => {
				const contact = parseContact(l.telegram)
				if (!contact) {
					unusable++
					return null
				}
				return {
					campaignId, ...contact, leadId: l.id,
					firstName: l.firstName, middleName: l.middleName, lastName: l.lastName,
					company: l.companyName, domain: l.domain,
				}
			})
			.filter(Boolean) as any[]

		// scanned и unusable нужны на том конце: «добавлено 0» без них читается
		// как «в базе никого нет», хотя причина может быть ровно обратной.
		return { ...(await this.insertRecipients(campaignId, rows, want)), scanned: leads.length, unusable }
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
		if (chosen.length) {
			await this.prisma.tgRecipient.createMany({ data: chosen })
			// Добавили — сразу раскладываем по времени. Иначе новый адресат
			// висел бы в календаре «без времени» до следующего запуска.
			await this.buildSchedule(campaignId)
		}
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
	async quickFill(
		count: number,
		campaignId?: string,
		opts?: { windowFrom?: number; windowTo?: number; start?: boolean; date?: string; force?: boolean },
	) {
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
			// Текст — из кода, всегда. Раньше он наследовался от предыдущей
			// кампании, и однажды введённая в админке формулировка закреплялась
			// навсегда: правка в коде до новых рассылок уже не доходила.
			//
			// Пределы и аккаунты, наоборот, наследуем: это настройки пула, они
			// меняются редко, и выставлять их заново каждый день — лишний шаг.
			const last = await this.prisma.tgCampaign.findFirst({ orderBy: { createdAt: 'desc' } })
			const accounts = last
				? await this.prisma.tgCampaignAccount.findMany({
						where: { campaignId: last.id },
						select: { accountId: true },
					})
				: []
			// Не нашлось ни одной прошлой кампании — берём все аккаунты, которым
			// разрешена рассылка. Иначе первое же нажатие кнопки упиралось бы в
			// «не выбрано ни одного аккаунта», а выбирать негде: настроек нет.
			const pool = last
				? accounts.map(a => a.accountId)
				: (
						await this.prisma.tgAccount.findMany({
							where: { mode: { in: ['SEND', 'BOTH'] }, status: { notIn: ['BANNED', 'ERROR', 'PAUSED'] } },
							select: { id: true },
						})
					).map(a => a.id)

			target = await this.prisma.tgCampaign.create({
				data: {
					name: new Date().toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }),
					firstMessage: FIRST_MESSAGE,
					secondMessage: SECOND_MESSAGE,
					dailyGoal: last?.dailyGoal ?? null,
					...(last
						? {
								perAccountPerDay: last.perAccountPerDay,
								minIntervalSec: last.minIntervalSec,
								maxIntervalSec: last.maxIntervalSec,
								windowFrom: last.windowFrom,
								windowTo: last.windowTo,
							}
						: {}),
					accounts: { create: pool.map(accountId => ({ accountId })) },
				},
			})
			created = true
		}

		// Окно и день применяем ДО набора: если тут же запускаем, расписание
		// должно считаться уже по новым, а не по унаследованным.
		const from = Number(opts?.windowFrom)
		const to = Number(opts?.windowTo)
		if (Number.isFinite(from) && Number.isFinite(to)) {
			if (from >= to) throw new BadRequestException('Окно отправки задано наоборот: конец раньше начала')
			await this.prisma.tgCampaign.update({ where: { id: target.id }, data: { windowFrom: from, windowTo: to } })
			target = { ...target, windowFrom: from, windowTo: to }
		}

		// День отправки. По умолчанию сегодня: «взять двадцать и запустить»
		// означает двадцать сегодня, а не двадцать когда-нибудь.
		const sendDate = parseDay(opts?.date) ?? startOfDay(new Date())
		await this.prisma.tgCampaign.update({ where: { id: target.id }, data: { sendDate } })
		target = { ...target, sendDate }

		// Разрешение работать сверх норм прогрева. Ставится на аккаунты пула:
		// флаг живёт на аккаунте, и отдельного «разового» режима заводить не
		// стоит — иначе их станет два, и никто не вспомнит, какой сейчас.
		if (opts?.force) {
			const links = await this.prisma.tgCampaignAccount.findMany({
				where: { campaignId: target.id },
				select: { accountId: true },
			})
			await this.prisma.tgAccount.updateMany({
				where: { id: { in: links.map(l => l.accountId) } },
				data: { forceSend: true },
			})
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

		// Пересобираем всегда: день мог смениться, нормы тоже.
		const plan = await this.buildSchedule(target.id)
		const queued = await this.prisma.tgRecipient.count({ where: { campaignId: target.id, status: 'QUEUED' } })

		return {
			campaignId: target.id, name: target.name, created, ...res,
			started: !!schedule, schedule,
			sendDate: dayString(sendDate),
			// Сколько из набранного реально встало на выбранный день и сколько
			// туда вообще влезает при текущих нормах.
			planned: plan.planned, capacity: plan.capacity,
			queued,
			bottleneck: await this.bottleneck(target, queued, plan.planned),
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
				allowOutgoing: maySend(a, allow),
				forceSend: a.forceSend,
				// Ниже 70 холодные сообщения слать рано: это тот же порог, по
				// которому считается «прогрет» в разделе прогрева.
				//
				// Флаг «без прогрева» сюда НЕ входит намеренно: он разрешает
				// отправку, но не делает аккаунт прогретым. Красное
				// предупреждение в карточке должно остаться — владелец решил
				// рискнуть, а не отменил риск.
				coldReady: allow.allowOutgoing && allow.readiness >= 70 && !!a.probe,
				todo,
			})
		}
		return rows.sort((a, b) => b.readiness - a.readiness)
	}

	/**
	 * Убрать человека из рассылки.
	 *
	 * Отправленное не трогаем: удалить адресата, с которым уже идёт переписка,
	 * значит стереть саму переписку — она уходит по каскаду. Такого просто не
	 * даём сделать: пусть остаётся в списке клиентов, где ему и место.
	 */
	async removeRecipient(id: string) {
		const r = await this.prisma.tgRecipient.findUnique({
			where: { id },
			select: { id: true, sentAt: true, campaignId: true },
		})
		if (!r) throw new NotFoundException('Адресат не найден')
		if (r.sentAt) {
			throw new BadRequestException('Этому уже писали — из рассылки его не убрать, переписка сохраняется')
		}
		await this.prisma.tgRecipient.delete({ where: { id } })
		return { ok: true, campaignId: r.campaignId }
	}

	/**
	 * Перенести отправку: другое время, другой аккаунт или и то и другое.
	 *
	 * Расписание строит планировщик, но оно не приговор: человека можно
	 * подвинуть руками — например, отложить на вечер или отдать более
	 * прогретому аккаунту. Пересборка после этого НЕ запускается: иначе
	 * следующее же изменение окна затёрло бы ручную правку, а смысл её ровно в
	 * том, чтобы она пережила автоматику.
	 *
	 * Единственное, что проверяем, — что аккаунт вообще в этой кампании.
	 * Время не проверяем: перенести на «вне окна» — осознанное решение, и
	 * отправщик его исполнит, когда окно откроется.
	 */
	async rescheduleRecipient(id: string, body: { at?: string | null; accountId?: string | null }) {
		const r = await this.prisma.tgRecipient.findUnique({
			where: { id },
			select: { id: true, status: true, campaignId: true },
		})
		if (!r) throw new NotFoundException('Адресат не найден')
		if (r.status !== 'QUEUED') throw new BadRequestException('Переносить можно только тех, кому ещё не писали')

		const data: any = {}

		// Замок снимается вместе со временем: «убрать время» означает вернуть
		// адресата в общую раскладку, а не подвесить его навсегда.
		data.scheduleLocked = true

		if (body.at !== undefined) {
			if (body.at === null || body.at === '') {
				data.scheduledAt = null
				data.scheduleLocked = false
			} else {
				const at = new Date(body.at)
				if (Number.isNaN(at.getTime())) throw new BadRequestException('Время не разобрали')
				data.scheduledAt = at
			}
		}

		if (body.accountId !== undefined) {
			if (!body.accountId) {
				data.plannedAccountId = null
			} else {
				const link = await this.prisma.tgCampaignAccount.findUnique({
					where: { campaignId_accountId: { campaignId: r.campaignId, accountId: body.accountId } },
					select: { id: true },
				})
				if (!link) throw new BadRequestException('Этого аккаунта нет в рассылке')
				data.plannedAccountId = body.accountId
			}
		}

		if (!Object.keys(data).length) return { ok: true }
		await this.prisma.tgRecipient.update({ where: { id }, data })
		return { ok: true }
	}

	/**
	 * Что именно уйдёт этому человеку — оба сообщения, уже с подстановками.
	 *
	 * Показывать шаблон со скобками бесполезно: вопрос всегда в том, как он
	 * развернётся на КОНКРЕТНОМ адресате — подставится ли отчество, во что
	 * превратится домен. Здесь ровно тот текст, что уйдёт в Telegram.
	 */
	async preview(id: string) {
		const r = await this.prisma.tgRecipient.findUnique({
			where: { id },
			include: {
				campaign: {
					select: {
						id: true, name: true, firstMessage: true, secondMessage: true,
						status: true, windowFrom: true, windowTo: true,
					},
				},
				plannedAccount: { select: { id: true, label: true, avatar: true, tgUserId: true } },
				account: { select: { id: true, label: true, avatar: true, tgUserId: true } },
			},
		})
		if (!r) throw new NotFoundException('Адресат не найден')

		const missing = missingPlaceholders(r.campaign.firstMessage, r)

		/*
		 * Почему до сих пор не ушло, если время прошло.
		 *
		 * Раньше панель просто печатала «уйдёт сегодня 16:43» и после
		 * наступления этого времени — и человек ждал отправки, которой не
		 * будет. Причина почти всегда в аккаунте: прогрев урезал ему дневную
		 * норму, аккаунт отключили или он вылетел из кампании. Считаем это
		 * здесь, где данные под рукой, и говорим прямо.
		 */
		let overdue: string | null = null
		if (r.status === 'QUEUED' && r.scheduledAt && r.scheduledAt < new Date()) {
			overdue = 'время прошло, но сообщение ещё не ушло'
			if (missing.length) {
				overdue = `не уйдёт: не хватает данных для текста (${missing.join(', ')})`
			} else if (r.campaign.status !== 'RUNNING') {
				overdue = `рассылка ${r.campaign.status === 'PAUSED' ? 'на паузе' : 'не запущена'} — отправка стоит`
			} else if (r.plannedAccountId) {
				const quota = await this.dailyQuota(
					await this.prisma.tgCampaign.findUniqueOrThrow({
						where: { id: r.campaignId },
						include: { accounts: { include: { account: true } } },
					}),
					dayKey(new Date()),
				)
				const norm = quota.get(r.plannedAccountId) ?? 0
				if (norm <= 0) {
					overdue = 'аккаунту, за которым он закреплён, прогрев не выдал сегодня нормы — уйдёт с другого или завтра'
				} else {
					const hour = mskHour(new Date())
					overdue = hour < r.campaign.windowFrom || hour >= r.campaign.windowTo
						? `сейчас вне окна ${r.campaign.windowFrom}:00–${r.campaign.windowTo}:00 по МСК — уйдёт, когда откроется`
						: 'аккаунт в очереди на отправку, уйдёт в ближайшие минуты'
				}
			}
		}

		return {
			overdue,
			id: r.id,
			name: [r.firstName, r.middleName, r.lastName].filter(Boolean).join(' ') || r.company || null,
			username: r.username,
			phone: r.phone,
			domain: r.domain,
			company: r.company,
			status: r.status,
			scheduledAt: r.scheduledAt,
			scheduleLocked: r.scheduleLocked,
			sentAt: r.sentAt,
			readAt: r.readAt,
			repliedAt: r.repliedAt,
			deliveryUnknown: r.deliveryUnknown,
			error: r.error,
			campaign: { id: r.campaign.id, name: r.campaign.name, status: r.campaign.status },
			account: r.account ?? r.plannedAccount,
			// Чего не хватает для подстановки. Пока не хватает — не уйдёт вовсе.
			missing,
			first: missing.length ? null : fillTemplate(r.campaign.firstMessage, r),
			// Второе не уходит само: его отправляет человек из переписки, после
			// ответа. Показываем целиком — с позициями и конкурентами, ровно
			// так, как оно уйдёт.
			second: await this.fullSecondMessage(
				r,
				r.campaign.secondMessage ? fillTemplate(r.campaign.secondMessage, r) : null,
			),
		}
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
		// Отсчёт от московской полуночи: столбцы графика группируются тем же
		// dayKey, и без этого крайние сутки съезжали бы на три часа.
		const since = mskAt(new Date(), 0, -(span - 1))

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
			/*
			 * Очередь пуста — рассылка закончилась, и сказать об этом надо сразу.
			 *
			 * Раньше это выяснялось только когда какой-нибудь аккаунт доходил до
			 * поиска следующего адресата. Но если писать некому — все аккаунты
			 * заняты, без нормы или без прокси, — до проверки дело не доходило
			 * вовсе, и кампания месяцами висела «Идёт», предлагая поставить на
			 * паузу то, что давно закончилось.
			 */
			if (!(await this.prisma.tgRecipient.count({ where: { campaignId: c.id, status: 'QUEUED' } }))) {
				await this.prisma.tgCampaign.update({
					where: { id: c.id },
					data: { status: 'DONE', finishedAt: now },
				})
				continue
			}

			// Вне окна отправки не пишем: сообщение в четыре утра само по себе метка.
			// Час московский: окна задаются и подписаны по Москве.
			const hour = mskHour(now)
			if (hour < c.windowFrom || hour >= c.windowTo) continue

			const today = dayKey(now)
			// Норма каждого аккаунта на сегодня. Если задана цель дня, она
			// раскладывается по готовности; иначе у каждого свой общий потолок.
			const quota = await this.dailyQuota(c, today)

			/*
			 * Кто сегодня вообще способен писать. Нужно, чтобы подобрать
			 * брошенных: адресат, закреплённый за аккаунтом с нулевой нормой
			 * или выбывшим из кампании, иначе висит вечно — по плану он «чужой»,
			 * и никто, кроме этого аккаунта, его не берёт. У нас так и вышло:
			 * норму аккаунтам урезал прогрев уже ПОСЛЕ того, как расписание
			 * было построено, и трое суток провисели непонятно почему.
			 */
			const working = c.accounts
				.filter(l => (quota.get(l.accountId) ?? 0) > 0)
				.map(l => l.accountId)

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
				if (!maySend(acc, allow)) {
					// Аккаунт с флагом сюда попадает только по вердикту Telegram —
					// в паузе стоит написать именно это, а не «мало готовности».
					const why = acc.forceSend
						? (forceable(acc).why ?? 'исходящие закрыты')
						: (allow.notes[0] ?? 'исходящие закрыты')
					await this.pauseAccount(link.id, 6 * 3600, why)
					continue
				}

				/*
				 * Аккаунт занимаем один раз на весь тик.
				 *
				 * Раньше это делалось внутри sendOne, на каждого адресата. Когда
				 * аккаунт был занят прогревом или опросом — а он в среднем занят
				 * заметную часть времени, — захват не удавался, sendOne возвращал
				 * «пропустить», и цикл ниже брал ТОГО ЖЕ адресата снова, до
				 * двадцати пяти раз за тик. Каждую минуту. На проде это накрутило
				 * одному адресату две тысячи попыток и ни одной отправки, молча:
				 * ни ошибки, ни паузы, ни строки в журнале.
				 *
				 * Занято — значит просто не наша очередь. Уходим до следующего
				 * тика, ничего не трогая.
				 */
				if (!(await this.warmup.claimAccount(acc.id, 'send', 120))) continue

				// Отсев тех, кому писать нечем, сетью не оплачивается, поэтому
				// пропускать их можно пачкой, не растягивая на сутки по одному.
				const SKIP_LIMIT = 25
				let verdict: SendVerdict = 'skipped'
				let done = false
				let planned = false
				try {
				for (let skipped = 0; skipped <= SKIP_LIMIT; skipped++) {
					// Сначала — тот, кому этому аккаунту пора писать по плану.
					let recipient = await this.prisma.tgRecipient.findFirst({
						where: {
							campaignId: c.id, status: 'QUEUED',
							plannedAccountId: acc.id, scheduledAt: { lte: now },
						},
						orderBy: { scheduledAt: 'asc' },
					})
					planned = !!recipient
					if (!recipient) {
						/*
						 * Свободные адресаты. Два случая:
						 *
						 * Без расписания — кампании, заведённые до него, и
						 * добавленные руками уже после сборки плана.
						 *
						 * Брошенные — просроченные больше чем на полчаса и
						 * закреплённые за аккаунтом, который сегодня не работает.
						 * Полчаса запаса нужны, чтобы не выхватывать чужое у
						 * аккаунта, который просто немного отстал от плана.
						 * Закреплённых вручную не трогаем: смысл закрепления в
						 * том, чтобы отправка ушла именно с этого аккаунта.
						 */
						recipient = await this.prisma.tgRecipient.findFirst({
							where: {
								campaignId: c.id, status: 'QUEUED',
								OR: [
									{ plannedAccountId: null },
									{
										scheduleLocked: false,
										scheduledAt: { lt: new Date(now.getTime() - 30 * 60_000) },
										plannedAccountId: { notIn: working.length ? working : ['-'] },
									},
								],
							},
							orderBy: [{ scheduledAt: 'asc' }, { createdAt: 'asc' }],
						})
					}
					if (!recipient) {
						// Пусто ИМЕННО у этого аккаунта — это не конец кампании:
						// у остальных план может быть расписан на дни вперёд.
						// Закрываем только когда в очереди не осталось никого.
						const left = await this.prisma.tgRecipient.count({
							where: { campaignId: c.id, status: 'QUEUED' },
						})
						if (!left) {
							await this.prisma.tgCampaign.update({
								where: { id: c.id },
								data: { status: 'DONE', finishedAt: now },
							})
							done = true
						}
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
				} finally {
					// Освобождаем в любом случае: иначе неожиданная ошибка
					// оставила бы аккаунт занятым до истечения захвата.
					await this.warmup.releaseAccount(acc.id)
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
						...(verdict === 'sent' ? { nextSendAt: await this.nextSendAfter(c, acc.id, now, planned) } : {}),
					},
				})
			}
		}
		return sent
	}

	/**
	 * Когда этому аккаунту писать в следующий раз.
	 *
	 * Если отправка шла по расписанию, берём время следующей записи плана — так
	 * календарь не разъезжается с делом. Раньше пауза бралась случайной каждый
	 * раз, и стоило одной вытянуться длиннее запланированной, как весь остаток
	 * дня уезжал: показанное время становилось всё более неправдой.
	 *
	 * Минимальную паузу всё равно выдерживаем: план мог быть собран при других
	 * настройках, а два сообщения подряд с одного аккаунта — это то, за что
	 * прилетает PEER_FLOOD.
	 */
	private async nextSendAfter(c: any, accountId: string, now: Date, planned: boolean): Promise<Date> {
		const floor = new Date(now.getTime() + Math.max(30, c.minIntervalSec) * 1000)
		if (planned) {
			const next = await this.prisma.tgRecipient.findFirst({
				where: { campaignId: c.id, status: 'QUEUED', plannedAccountId: accountId, scheduledAt: { not: null } },
				orderBy: { scheduledAt: 'asc' },
				select: { scheduledAt: true },
			})
			if (next?.scheduledAt) return next.scheduledAt > floor ? next.scheduledAt : floor
		}
		const spread = Math.max(1, c.maxIntervalSec - c.minIntervalSec)
		return new Date(now.getTime() + (c.minIntervalSec + Math.floor(Math.random() * spread)) * 1000)
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
		const rows = []

		for (const l of links) {
			const acc = l.account
			const dead = acc.status === 'BANNED' || acc.status === 'ERROR' || acc.status === 'PAUSED'
			const allow = dead ? null : await this.warmup.allowanceFor(acc, 0)

			// Предохранитель прогрева: сколько исходящих в сутки он считает
			// безопасным для ЭТОГО аккаунта. Раньше рассылка его не спрашивала
			// вовсе и всем раздавала perAccountPerDay — то есть вся система
			// готовности на рассылку не влияла, и суточный аккаунт с нормой
			// «ноль сообщений» спокойно получал двадцать.
			//
			// Флаг владельца предохранитель снимает: тогда предел задаёт только
			// кампания. Это осознанный риск, и он должен быть его решением, а не
			// побочным следствием того, что проверку забыли сделать.
			const safe = acc.forceSend ? campaign.perAccountPerDay : (allow?.dailyMessages ?? 0)

			// Уже отправленное сегодня из потолка не вычитаем: раскладка — это
			// план на сутки целиком, а не остаток. Иначе доля аккаунта менялась
			// бы после каждого сообщения.
			rows.push({
				id: acc.id,
				readiness: allow?.readiness ?? 0,
				canSend: !dead && maySend(acc, allow),
				ceiling: Math.max(0, Math.min(campaign.perAccountPerDay, safe)),
				manual: typeof l.dailyLimit === 'number' ? Math.max(0, l.dailyLimit) : null,
			})
		}

		const out = new Map<string, number>()
		// Проставленное руками — это решение о делёжке, и оно исполняется как
		// сказано. Потолок аккаунта его всё равно ограничивает: разделить можно
		// только то, что аккаунт способен унести.
		for (const r of rows) {
			if (r.manual != null) out.set(r.id, r.canSend ? Math.min(r.manual, r.ceiling) : 0)
		}

		const auto = rows.filter(r => r.manual == null)

		// Без цели дня делёжки нет: каждый работает по своему потолку.
		if (!campaign.dailyGoal) {
			for (const r of auto) out.set(r.id, r.canSend ? r.ceiling : 0)
			return out
		}

		// С целью делим ОСТАТОК после ручных: они уже забрали свою часть.
		const taken = rows.reduce((n, r) => n + (r.manual != null ? Math.min(r.manual, r.ceiling) : 0), 0)
		const left = Math.max(0, campaign.dailyGoal - taken)
		for (const [id, n] of distributeDaily(left, auto.map(r => ({ ...r, cap: r.ceiling })))) {
			out.set(id, n)
		}
		return out
	}

	/**
	 * Раздать дневную цель по аккаунтам руками.
	 *
	 * Сумма проставленных не может быть больше цели дня — это делёжка одного
	 * числа, а не набор независимых лимитов. Аккаунты без числа разбирают
	 * остаток сами, по готовности.
	 */
	async setLimits(campaignId: string, limits: Record<string, number | null>) {
		const c = await this.prisma.tgCampaign.findUnique({
			where: { id: campaignId },
			include: { accounts: true },
		})
		if (!c) throw new NotFoundException('Кампания не найдена')

		const next = new Map<string, number | null>()
		for (const l of c.accounts) next.set(l.accountId, l.dailyLimit ?? null)
		for (const [accountId, value] of Object.entries(limits ?? {})) {
			if (!next.has(accountId)) continue
			if (value === null || value === undefined || (value as any) === '') {
				next.set(accountId, null)
				continue
			}
			const n = Math.round(Number(value))
			if (!Number.isFinite(n) || n < 0) throw new BadRequestException('Лимит аккаунта: целое число от нуля')
			if (n > c.perAccountPerDay) {
				throw new BadRequestException(`Больше потолка на аккаунт нельзя: ${c.perAccountPerDay} в день`)
			}
			next.set(accountId, n)
		}

		const total = [...next.values()].reduce((s: number, v) => s + (v ?? 0), 0)
		if (c.dailyGoal && total > c.dailyGoal) {
			throw new BadRequestException(
				`Роздано ${total} из ${c.dailyGoal}: это больше цели дня. Уменьшите или поднимите цель`,
			)
		}

		for (const l of c.accounts) {
			const value = next.get(l.accountId) ?? null
			if (value === (l.dailyLimit ?? null)) continue
			await this.prisma.tgCampaignAccount.update({ where: { id: l.id }, data: { dailyLimit: value } })
		}

		// Нормы изменились — расписание по старым уже неверно.
		await this.buildSchedule(campaignId)
		return { assigned: total, goal: c.dailyGoal, left: c.dailyGoal ? Math.max(0, c.dailyGoal - total) : null }
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

		// Аккаунт уже занят вызывающим на весь тик — здесь его не трогаем.
		const opts = this.warmup.clientOptions(account)

		/*
		 * С этого момента исход перестаёт быть однозначным.
		 *
		 * Пока идёт поиск собеседника, любая ошибка означает «не отправляли» —
		 * адресата можно спокойно вернуть в очередь. Но как только запрос на
		 * отправку ушёл, обрыв связи или таймаут больше НЕ означают, что
		 * сообщение не дошло: сервер мог его принять, а ответ до нас не
		 * добрался. Вернуть такого в очередь — значит написать человеку второй
		 * раз одно и то же, а это худшее, что можно сделать в холодной рассылке.
		 */
		let attempted = false

		try {
			const { result, session } = await withClient(opts, async client => {
				const peer = await this.resolvePeer(client, recipient)
				attempted = true
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

			/*
			 * Исход неизвестен: запрос на отправку уже ушёл, а чем кончился —
			 * не знаем. Оставляем адресата отправленным и помечаем: пусть
			 * лучше сообщение не дойдёт, чем придёт дважды.
			 *
			 * Отказы сервера сюда не попадают: FLOOD_WAIT, PEER_FLOOD, бан и
			 * приватность — это ОТВЕТ Telegram, то есть он запрос обработал и
			 * отклонил. Сообщение при них не уходило, и адресат честно
			 * возвращается в очередь ниже.
			 */
			const ambiguous = attempted && (failure.kind === 'timeout' || failure.kind === 'proxy' || failure.kind === 'other')

			if (ambiguous) {
				await this.prisma.tgRecipient.update({
					where: { id: recipient.id },
					data: {
						status: 'SENT', sentAt: new Date(), deliveryUnknown: true, sentMsgId: null,
						error: `Связь оборвалась при отправке: ${failure.message.slice(0, 200)}. Повторно НЕ отправляем — проверьте переписку`,
					},
				})
				await this.warmup.applyFailure(account.id, failure)
				await this.pauseAccount(link.id, 1800, failure.message)
				this.logger.warn(`Отправка с неизвестным исходом: адресат ${recipient.id}, ${failure.message}`)
				return 'failed'
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
					/*
					 * Вложения, записанные до того, как мы научились их разбирать.
					 *
					 * Такие строки лежат в базе как «[вложение без текста]» — при
					 * записи мы не сохранили ни вида, ни содержимого, а обычный
					 * опрос до них уже не дойдёт: он берёт сообщения новее
					 * lastSeenMsgId. Спрашиваем их отдельно, по конкретным id, и
					 * только один раз: заполнили — больше не попадают в выборку.
					 */
					const legacy = await this.prisma.tgDialogMessage.findMany({
						where: {
							recipientId: { in: list.map(r => r.id) },
							out: false,
							mediaKind: null,
							text: { startsWith: '[вложение' },
						},
						select: { id: true, recipientId: true, tgId: true },
					})
					const legacyBy = new Map<string, Array<{ id: string; tgId: number }>>()
					for (const m of legacy) {
						const arr = legacyBy.get(m.recipientId)
						if (arr) arr.push({ id: m.id, tgId: m.tgId })
						else legacyBy.set(m.recipientId, [{ id: m.id, tgId: m.tgId }])
					}

					// История тянется только там, где что-то изменилось.
					const fetched: Array<{ id: string; messages: any[]; media: Map<number, { data: string | null; mime: string }> }> = []
					const backfill: Array<{ rowId: string; kind: string; name: string | null; size: number | null; text: string; data: string | null }> = []

					for (const item of out) {
						const old = legacyBy.get(item.recipient.id)
						if (old?.length) {
							try {
								const msgs: any = await call(client, 'getMessages', () =>
									client.getMessages(item.entity, { ids: old.map(x => x.tgId) }),
								)
								for (const m of (msgs ?? []) as any[]) {
									if (!m?.id) continue
									const row = old.find(x => x.tgId === Number(m.id))
									const info = mediaOf(m)
									if (!row || !info) continue
									let data: string | null = null
									if (worthDownloading(info)) {
										try {
											const buf: any = await call(client, 'downloadMedia', () => client.downloadMedia(m))
											if (buf?.length) data = `data:${mimeFor(info)};base64,${Buffer.from(buf).toString('base64')}`
										} catch { /* не скачалось — вид всё равно запишем */ }
									}
									backfill.push({
										rowId: row.id, kind: info.kind, name: info.name, size: info.size,
										text: String(m.message ?? '') || mediaCaption(info), data,
									})
								}
							} catch {
								// Переписку могли удалить с той стороны — тогда этих
								// сообщений больше нет ни у кого, и это не наша ошибка.
							}
						}

						if (item.top <= item.recipient.lastSeenMsgId) continue
						const msgs: any = await call(client, 'getMessages', () =>
							client.getMessages(item.entity, { limit: 40, minId: item.recipient.lastSeenMsgId }),
						)

						/*
						 * Вложения забираем здесь же, пока подключение открыто и
						 * сообщение под рукой. Отдельным заходом позже это стоило
						 * бы нового коннекта на каждую картинку.
						 *
						 * Только входящие и только мелкие: свои картинки мы и так
						 * знаем, а чужое видео на мобильном прокси — оплаченный
						 * трафик ради превью, которое всё равно не покажем.
						 */
						const media = new Map<number, { data: string | null; mime: string }>()
						for (const m of (msgs ?? []) as any[]) {
							if (!m?.id || m.out) continue
							const info = mediaOf(m)
							if (!info || !worthDownloading(info)) continue
							try {
								const buf: any = await call(client, 'downloadMedia', () => client.downloadMedia(m))
								if (buf?.length) {
									media.set(Number(m.id), {
										data: Buffer.from(buf).toString('base64'),
										mime: mimeFor(info),
									})
								}
							} catch {
								// Не скачалось — не беда: вид и размер всё равно запишем.
							}
						}
						fetched.push({ id: item.recipient.id, messages: msgs ?? [], media })
					}
					return { out, fetched, backfill }
				})
				await this.warmup.persistSession(account.id, opts.session, session)

				// Дозаполняем то, что раньше записалось безымянным вложением.
				for (const b of result.backfill) {
					await this.prisma.tgDialogMessage.update({
						where: { id: b.rowId },
						data: { mediaKind: b.kind, mediaName: b.name, mediaSize: b.size, mediaData: b.data, text: b.text },
					}).catch(() => undefined)
				}
				if (result.backfill.length) changed += result.backfill.length

				const history = new Map(result.fetched.map(f => [f.id, f.messages]))
				const media = new Map(result.fetched.map(f => [f.id, f.media]))
				for (const item of result.out) {
					const before = !!item.recipient.repliedAt
					if (await this.applyDialogState(item, history.get(item.recipient.id) ?? [], account, media.get(item.recipient.id))) {
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
		/** Скачанные вложения входящих: id сообщения → содержимое. */
		media?: Map<number, { data: string | null; mime: string }>,
	): Promise<boolean> {
		const r = item.recipient
		const patch: any = {}

		// Прочтение: собеседник прочитал наше сообщение, если его id не больше
		// границы прочитанного исходящего.
		if (!r.readAt && r.sentMsgId && item.readTo >= r.sentMsgId) patch.readAt = new Date()

		/*
		 * Разрешаем сомнение в ПОЛОЖИТЕЛЬНУЮ сторону и только в неё.
		 *
		 * Если в переписке нашлось наше исходящее — значит отправка всё-таки
		 * прошла: снимаем пометку и восстанавливаем id сообщения, по которому
		 * дальше считается прочтение. Обратный вывод («в диалогах не нашли,
		 * значит не дошло») здесь делать нельзя: getDialogs берёт сотню
		 * последних, и отсутствие в ней — не доказательство. Такие остаются
		 * помеченными, и решение принимает человек.
		 */
		if (r.deliveryUnknown) {
			const ours = messages.filter(m => m?.out && m?.id).map(m => Number(m.id))
			if (ours.length) {
				patch.deliveryUnknown = false
				patch.sentMsgId = Math.min(...ours)
				patch.error = null
			}
		}

		let incoming: any[] = []
		if (messages.length) {
			const rows = messages
				.filter(m => m?.id && (m.message || m.out !== undefined))
				.map(m => {
					const info = mediaOf(m)
					const got = media?.get(Number(m.id))
					return {
						recipientId: r.id,
						tgId: Number(m.id),
						out: !!m.out,
						// Подпись к вложению — это и есть текст сообщения. Пустую
						// строку не пишем: в ленте она выглядела бы как пропажа.
						text: String(m.message ?? '') || (info ? mediaCaption(info) : '[пустое сообщение]'),
						date: m.date ? new Date(Number(m.date) * 1000) : new Date(),
						mediaKind: info?.kind ?? null,
						mediaName: info?.name ?? null,
						mediaSize: info?.size ?? null,
						mediaData: got?.data ? `data:${got.mime};base64,${got.data}` : null,
					}
				})
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
			deliveryUnknown: r.deliveryUnknown,
			campaign: r.campaign, account: r.account,
			// Полный текст: с позициями лида и теми, кто выше него. Заготовка из
			// кода остаётся хвостом, а начало собирается по его выдаче.
			secondPreview: await this.fullSecondMessage(
				r,
				r.campaign.secondMessage ? fillTemplate(r.campaign.secondMessage, r) : null,
			),
			messages: r.messages.map(m => ({
				id: m.id, out: m.out, text: m.text, date: m.date,
				// Вложение: вид нужен всегда, содержимое — только если мелкое
				// и мы его забрали.
				mediaKind: m.mediaKind, mediaData: m.mediaData,
				mediaName: m.mediaName, mediaSize: m.mediaSize,
			})),
		}
	}

	/**
	 * Второе сообщение целиком: с позициями лида и теми, кто выше него.
	 *
	 * Заготовка в campaign-preset.ts — это только хвост письма, рассказ о нас.
	 * Начало у каждого своё: по каким запросам он в выдаче, на каких местах и
	 * кто стоит над ним. Ради этих двух абзацев письмо и читают — без них оно
	 * превращается в обычное «мы занимаемся продвижением».
	 *
	 * Данные берём у лида, из которого адресат заведён: ключи — из выдачи того
	 * же прогона парсера, конкурентов — из карточки. Если адресат добавлен
	 * руками и лида за ним нет, остаётся заготовка: сочинять позиции нельзя.
	 */
	private async fullSecondMessage(r: {
		leadId: string | null
		domain: string | null
		firstName: string | null
		middleName: string | null
	}, fallback: string | null): Promise<string | null> {
		if (!r.leadId) return fallback

		const lead = await this.prisma.outreachLead.findUnique({
			where: { id: r.leadId },
			select: { domain: true, importId: true, competitors: true },
		})
		if (!lead) return fallback

		let keywords: MessageKeyword[] = []
		if (lead.importId) {
			const rows = await this.prisma.serpRow.findMany({
				where: { importId: lead.importId, domain: lead.domain },
				orderBy: { position: 'asc' },
				select: { keyword: true, position: true },
			})
			// Берём ЛУЧШУЮ позицию по каждому запросу и только те, где есть что
			// улучшать: писать «вы на первом месте, давайте поднимем» нелепо.
			// Логика та же, что в кабинете менеджера, — см. leadKeywords.
			const best = new Map<string, MessageKeyword>()
			for (const row of rows) if (!best.has(row.keyword)) best.set(row.keyword, row)
			keywords = [...best.values()].filter(
				k => k.position >= MESSAGE_POSITION_MIN && k.position <= MESSAGE_POSITION_MAX,
			)
		}

		const competitors = (Array.isArray(lead.competitors) ? lead.competitors : []) as MessageCompetitor[]
		// Ни позиций, ни конкурентов — значит рассказать нечего, и полный текст
		// выродится в ту же заготовку. Тогда честнее её и оставить.
		if (!keywords.length && !competitors.length) return fallback

		return buildOutreachMessage({
			domain: r.domain ?? lead.domain,
			firstName: r.firstName,
			middleName: r.middleName,
			keywords,
			competitors,
		})
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
	/**
	 * Состояние аккаунтов кампании на начало планирования.
	 *
	 * Отсев ровно тот же, что у отправщика: забаненные, ошибочные, снятые на
	 * паузу и отведённые только под прогрев не участвуют. Расписание, которое
	 * учитывает аккаунт, не умеющий писать, — просто красивая картинка.
	 */
	private async slotsFor(c: any, now: Date, dayShift = 0): Promise<PlanSlot[]> {
		const today = dayKey(now)
		const quota = await this.dailyQuota(c, today)
		const slots: PlanSlot[] = []

		for (const link of c.accounts) {
			const acc = link.account
			if (acc.status === 'BANNED' || acc.status === 'ERROR' || acc.status === 'PAUSED') continue
			if (acc.mode === 'WARM') continue
			const allow = await this.warmup.allowanceFor(acc, 0)
			if (!maySend(acc, allow)) continue

			const cap = quota.get(acc.id) ?? 0
			// Сегодняшний счётчик вычитаем только когда планируем сегодня: на
			// завтра у аккаунта снова полная норма.
			const sent = dayShift === 0 && link.dayKey === today ? link.sentToday : 0
			const floor = Math.max(link.nextSendAt?.getTime() ?? 0, link.pausedUntil?.getTime() ?? 0)
			slots.push({
				id: acc.id,
				quota: cap,
				left: Math.max(0, cap - sent),
				cursor: startCursor(now, c, floor, dayShift),
				floor,
				day: dayShift,
				readiness: allow.readiness,
			})
		}
		return slots
	}

	/**
	 * На какой день по счёту от сегодня назначена рассылка.
	 *
	 * Прошедшая дата — это сегодня: назначить отправку во вчера нельзя, а
	 * молча не отправить ничего хуже, чем отправить сегодня.
	 */
	private dayShiftOf(c: { sendDate: Date | null }, now: Date): number | null {
		if (!c.sendDate) return null
		const target = startOfDay(c.sendDate)
		const diff = Math.round((target.getTime() - startOfDay(now).getTime()) / 86400000)
		return Math.max(0, diff)
	}

	/**
	 * Пересобрать расписание и записать его в базу.
	 *
	 * Записываем, а не считаем каждый раз заново, по двум причинам. Аккаунт
	 * выбирается случайно — такой выбор надо запомнить, иначе при каждом
	 * открытии календаря он был бы другим. И отправщик обязан идти по тому же
	 * плану, который человек видел: календарь, расходящийся с делом, вреднее
	 * отсутствия календаря.
	 *
	 * Планируются только те, кому есть чем писать: без данных для подстановки
	 * сообщение всё равно не уйдёт, и держать такого адресата в календаре —
	 * врать самому себе.
	 */
	async buildSchedule(campaignId: string) {
		const c = await this.prisma.tgCampaign.findUnique({
			where: { id: campaignId },
			include: { accounts: { include: { account: true } } },
		})
		if (!c) throw new NotFoundException('Кампания не найдена')

		const now = new Date()
		const queued = await this.prisma.tgRecipient.findMany({
			where: { campaignId, status: 'QUEUED' },
			orderBy: { createdAt: 'asc' },
			select: {
				id: true, firstName: true, middleName: true, lastName: true, company: true, domain: true,
				scheduleLocked: true, plannedAccountId: true, scheduledAt: true,
			},
		})
		// Закреплённых руками не планируем заново — но и не делаем вид, что их
		// нет: место в дневной норме своего аккаунта они занимают.
		const locked = queued.filter(r => r.scheduleLocked && r.scheduledAt)
		const willWrite = queued.filter(r => !r.scheduleLocked && missingPlaceholders(c.firstMessage, r).length === 0)

		const shift = this.dayShiftOf(c, now)
		const slots = await this.slotsFor(c, now, shift ?? 0)
		for (const s of slots) {
			const taken = locked.filter(r => r.plannedAccountId === s.id).length
			s.left = Math.max(0, s.left - taken)
			s.quota = Math.max(0, s.quota - taken)
		}
		const plan = planQueue(willWrite.map(r => r.id), slots, c, now, { singleDay: shift != null })

		// Сначала снимаем прежний план со всей очереди, потом раскладываем
		// новый: адресат, выпавший из плана (аккаунт убрали, данных не хватает),
		// иначе остался бы с прошлым временем и попал в календарь как живой.
		await this.prisma.tgRecipient.updateMany({
			where: { campaignId, status: 'QUEUED', scheduleLocked: false },
			data: { scheduledAt: null, plannedAccountId: null },
		})

		// Пачками: у каждого адресата своё время, одним updateMany не выйдет, а
		// пятьсот отдельных запросов подряд — это пятьсот обращений к базе.
		const entries = [...plan]
		for (let i = 0; i < entries.length; i += 200) {
			await this.prisma.$transaction(
				entries.slice(i, i + 200).map(([id, p]) =>
					this.prisma.tgRecipient.update({
						where: { id },
						data: { scheduledAt: p.at, plannedAccountId: p.accountId },
					}),
				),
			)
		}

		return {
			planned: plan.size + locked.length,
			unplanned: queued.length - plan.size - locked.length,
			/** Сколько строк переставлено руками и оставлено как есть. */
			locked: locked.length,
			accounts: slots.length,
			// Сколько всего влезает в выбранный день: по этому числу видно, надо
			// ли поднимать нормы или добавлять аккаунты.
			capacity: slots.reduce((n, s) => n + s.left, 0),
			sendDate: dayString(c.sendDate),
		}
	}

	/**
	 * Календарь на сутки вперёд, столько дней, сколько занимает очередь.
	 *
	 * Кроме запланированного показывает и уже отправленное за эти дни: иначе к
	 * вечеру день выглядит пустым, хотя по нему прошло двадцать сообщений, и
	 * непонятно, случилось что-то или нет.
	 */
	async calendar(campaignId: string) {
		const c = await this.prisma.tgCampaign.findUnique({
			where: { id: campaignId },
			include: { accounts: { include: { account: true } } },
		})
		if (!c) throw new NotFoundException('Кампания не найдена')

		const pick = {
			id: true, username: true, phone: true, status: true,
			firstName: true, middleName: true, lastName: true, company: true, domain: true,
			scheduledAt: true, plannedAccountId: true, sentAt: true, accountId: true, error: true,
			scheduleLocked: true,
		}
		const [queued, done] = await Promise.all([
			this.prisma.tgRecipient.findMany({
				where: { campaignId, status: 'QUEUED' },
				orderBy: [{ scheduledAt: 'asc' }, { createdAt: 'asc' }],
				select: pick,
			}),
			// Уже ушедшее берём с начала сегодняшних суток: раньше это уже не
			// «что происходит», а история, и ей место в списке адресатов.
			this.prisma.tgRecipient.findMany({
				where: { campaignId, sentAt: { gte: startOfDay(new Date()) } },
				orderBy: { sentAt: 'asc' },
				select: pick,
			}),
		])

		const shift = this.dayShiftOf(c, new Date())
		// Кто из аккаунтов вообще может писать прямо сейчас. Нужно, чтобы
		// отличить «очередь длиннее норм» от «писать некому»: снаружи и то и
		// другое выглядит как пустой календарь, а чинится по-разному.
		const slots = await this.slotsFor(c, new Date(), shift ?? 0)
		const ready = new Set(slots.map(s => s.id))
		const notReady = []
		for (const link of c.accounts) {
			if (ready.has(link.accountId)) continue
			const acc = link.account
			const dead = acc.status === 'BANNED' || acc.status === 'ERROR' || acc.status === 'PAUSED'
			const allow = dead ? null : await this.warmup.allowanceFor(acc, 0)
			const hard = forceable(acc)
			notReady.push({
				id: acc.id,
				label: acc.label,
				avatar: acc.avatar,
				why: dead
					? `аккаунт ${acc.status === 'BANNED' ? 'заблокирован' : acc.status === 'ERROR' ? 'с ошибкой' : 'на паузе'}`
					: acc.mode === 'WARM'
						? 'отведён только под прогрев'
						: !hard.ok
							? hard.why!
							: (allow?.notes?.[0] ?? 'исходящие пока закрыты'),
				readiness: allow?.readiness ?? 0,
				forceSend: !!acc.forceSend,
				// Можно ли включить принудительную рассылку прямо отсюда.
				// У мёртвых и заспамленных нельзя — и врать об этом не надо.
				forceable: !dead && acc.mode !== 'WARM' && hard.ok,
			})
		}

		const byId = new Map(c.accounts.map(l => [l.account.id, l.account]))
		const name = (r: any) =>
			[r.firstName, r.lastName].filter(Boolean).join(' ')
			|| r.company
			|| (r.username ? `@${r.username}` : null)
			|| r.phone
			|| 'без имени'

		const event = (r: any, at: Date, sent: boolean) => {
			const acc = byId.get(sent ? r.accountId : r.plannedAccountId) ?? null
			return {
				id: r.id,
				at: at.toISOString(),
				name: name(r),
				username: r.username,
				domain: r.domain,
				sent,
				status: r.status,
				accountId: acc?.id ?? null,
				accountLabel: acc?.label ?? null,
				accountAvatar: acc?.avatar ?? null,
				tgUserId: acc?.tgUserId ?? null,
				locked: !!r.scheduleLocked,
			}
		}

		const days = new Map<string, any[]>()
		const add = (r: any, at: Date, sent: boolean) => {
			const key = dayKey(at)
			const list = days.get(key)
			if (list) list.push(event(r, at, sent))
			else days.set(key, [event(r, at, sent)])
		}
		for (const r of done) if (r.sentAt) add(r, r.sentAt, true)
		for (const r of queued) if (r.scheduledAt) add(r, r.scheduledAt, false)

		// Кому времени не досталось: не хватает данных для текста, кончились
		// нормы или расписание вообще не собирали.
		//
		// Последнее надо отличать от первых двух. Отсутствие времени у адресата
		// само по себе не говорит НИЧЕГО о причине: у кампании, заведённой до
		// расписания, его просто некому было проставить. Написать такому
		// «не хватило норм» — прямая ложь, чинить он пойдёт не то.
		const neverPlanned = !queued.some(r => r.scheduledAt || r.plannedAccountId)
		const unplanned = queued
			.filter(r => !r.scheduledAt)
			.map(r => ({
				id: r.id,
				name: name(r),
				username: r.username,
				why: missingPlaceholders(c.firstMessage, r).length
					? `нет данных: ${missingPlaceholders(c.firstMessage, r).join(', ')}`
					: neverPlanned && slots.length
						? 'расписание ещё не собрано'
						: !slots.length
						? 'писать некому: ни один аккаунт не готов'
						// Аккаунт в строю, но нормы ему не выдали — так бывает, пока
						// он греется: готовность низкая, и дневная цель до него не
						// доходит. «Не хватило норм» тут прозвучало бы как «добавьте
						// потолок», а лечится это только временем.
						: slots.every(x => x.quota <= 0)
							? 'аккаунтам ещё не выдана дневная норма — они греются'
							: shift != null
								? 'не влезло в выбранный день'
								: 'не хватило дневных норм',
			}))

		return {
			campaignId: c.id,
			name: c.name,
			status: c.status,
			windowFrom: c.windowFrom,
			windowTo: c.windowTo,
			minIntervalSec: c.minIntervalSec,
			maxIntervalSec: c.maxIntervalSec,
			dailyGoal: c.dailyGoal,
			perAccountPerDay: c.perAccountPerDay,
			accounts: c.accounts.map(l => ({
				id: l.account.id,
				label: l.account.label,
				avatar: l.account.avatar,
				tgUserId: l.account.tgUserId,
				forceSend: l.account.forceSend,
			})),
			// Сколько аккаунтов реально может писать и что мешает остальным.
			ready: slots.length,
			notReady,
			// День, на который назначена рассылка, и сколько в него влезает.
			sendDate: dayString(c.sendDate),
			capacity: slots.reduce((n, x) => n + x.left, 0),
			/** Расписание для этой кампании ни разу не собирали. */
			neverPlanned: neverPlanned && queued.length > 0,
			days: [...days]
				.sort(([a], [b]) => (a < b ? -1 : 1))
				.map(([key, items]) => ({
					key,
					items: items.sort((x, y) => (x.at < y.at ? -1 : 1)),
					total: items.length,
					sent: items.filter(i => i.sent).length,
				})),
			unplanned,
		}
	}

	/**
	 * Когда и с какого аккаунта уйдёт каждое сообщение.
	 *
	 * Читает записанное расписание, а не считает своё: показывать одно, а
	 * отправлять по другому нельзя. Если расписание не собирали вовсе — старая
	 * кампания, — прикидываем на месте и НЕ записываем: цифры «сегодня уйдёт
	 * столько» нужны и там, а молча менять план у работающей рассылки нельзя.
	 */
	async forecast(campaignId: string) {
		const empty = { times: {} as Record<string, PlannedSend>, finishAt: null as string | null, skipped: 0, today: 0, unplanned: 0 }
		const c = await this.prisma.tgCampaign.findUnique({
			where: { id: campaignId },
			include: { accounts: { include: { account: true } } },
		})
		if (!c) return empty

		const queued = await this.prisma.tgRecipient.findMany({
			where: { campaignId, status: 'QUEUED' },
			orderBy: { createdAt: 'asc' },
			select: {
				id: true, firstName: true, middleName: true, lastName: true, company: true, domain: true,
				scheduledAt: true, plannedAccountId: true,
			},
		})
		const willWrite = queued.filter(r => missingPlaceholders(c.firstMessage, r).length === 0)
		const skipped = queued.length - willWrite.length

		const times: Record<string, PlannedSend> = {}
		const byId = new Map(c.accounts.map(l => [l.account.id, l.account]))
		const put = (id: string, at: Date, accountId: string) => {
			const acc = byId.get(accountId)
			times[id] = {
				at: at.toISOString(),
				accountId,
				accountLabel: acc?.label ?? null,
				tgUserId: acc?.tgUserId ?? null,
			}
		}

		for (const r of willWrite) {
			if (r.scheduledAt && r.plannedAccountId && byId.has(r.plannedAccountId)) {
				put(r.id, r.scheduledAt, r.plannedAccountId)
			}
		}

		// Ни одного запланированного при непустой очереди — расписание никогда
		// не собирали. Прикидка нужна, чтобы карточка не показывала нули.
		if (!Object.keys(times).length && willWrite.length) {
			const now = new Date()
			const shift = this.dayShiftOf(c, now)
			const slots = await this.slotsFor(c, now, shift ?? 0)
			const projected = planQueue(willWrite.map(r => r.id), slots, c, now, { singleDay: shift != null })
			for (const [id, p] of projected) put(id, p.at, p.accountId)
		}

		const all = Object.values(times).map(t => new Date(t.at).getTime())
		const endOfToday = windowStart(new Date(), c.windowTo, 0).getTime()

		return {
			times,
			finishAt: all.length ? new Date(Math.max(...all)).toISOString() : null,
			skipped,
			// Главная цифра при запуске «на сегодня».
			today: all.filter(t => t < endOfToday).length,
			// Кому времени не досталось: норм не хватило либо не собирали план.
			unplanned: willWrite.length - Object.keys(times).length,
		}
	}

	/**
	 * Люди по всем рассылкам сразу, разложенные по стадии разговора.
	 *
	 * Стадий три, и это НЕ статусы из базы: статусов восемь, и половина из них
	 * отвечает на вопрос «что случилось», а не «докуда дошли». Здесь важно
	 * второе — сколько сообщений человек от нас получил.
	 *
	 *   не отправлено — стоит в очереди, первого касания ещё не было
	 *   1 сообщение   — открывающее ушло; прочитал он или ответил, видно в строке
	 *   2 сообщение   — отправили и второе, разговор идёт
	 *
	 * Кому написать не смогли (заблокировал, приватность, ошибка) отдельной
	 * вкладкой не выношу: их немного, и они видны во «Всех» с красной пометкой.
	 * Иначе список стадий перестаёт читаться как путь и превращается в
	 * перечисление статусов, от которого и уходим.
	 */
	async clients(stage = 'all', limit = 200, query?: string) {
		const take = Math.max(1, Math.min(1000, Math.round(limit || 200)))
		const q = String(query ?? '').trim()

		const where: any = {}
		if (STAGE_STATUS[stage]) where.status = { in: STAGE_STATUS[stage] }
		if (q) {
			where.OR = [
				{ username: { contains: q, mode: 'insensitive' } },
				{ phone: { contains: q } },
				{ firstName: { contains: q, mode: 'insensitive' } },
				{ lastName: { contains: q, mode: 'insensitive' } },
				{ company: { contains: q, mode: 'insensitive' } },
				{ domain: { contains: q, mode: 'insensitive' } },
			]
		}

		const [rows, grouped] = await Promise.all([
			this.prisma.tgRecipient.findMany({
				where,
				take,
				orderBy: stage === 'queued'
					// В очереди интересно, кто следующий, поэтому по времени
					// отправки вперёд. В остальных стадиях — свежие сверху.
					? [{ scheduledAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }]
					: [{ sentAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
				select: {
					id: true, username: true, phone: true, status: true,
					firstName: true, middleName: true, lastName: true, company: true, domain: true,
					scheduledAt: true, sentAt: true, readAt: true, repliedAt: true, secondSentAt: true,
					blockedAt: true, error: true, deliveryUnknown: true,
					campaign: { select: { id: true, name: true } },
					account: { select: { id: true, label: true, avatar: true, tgUserId: true } },
					plannedAccountId: true,
				},
			}),
			this.prisma.tgRecipient.groupBy({ by: ['status'], _count: { _all: true } }),
		])

		const byStatus = new Map(grouped.map(g => [String(g.status), g._count._all]))
		const sum = (list: string[]) => list.reduce((n, st) => n + (byStatus.get(st) ?? 0), 0)

		return {
			counts: {
				all: [...byStatus.values()].reduce((a, b) => a + b, 0),
				queued: sum(STAGE_STATUS.queued),
				first: sum(STAGE_STATUS.first),
				second: sum(STAGE_STATUS.second),
				problem: sum(STAGE_STATUS.problem),
			},
			rows: rows.map(r => ({
				id: r.id,
				name: [r.firstName, r.lastName].filter(Boolean).join(' ')
					|| r.company
					|| (r.username ? `@${r.username}` : null)
					|| r.phone
					|| 'без имени',
				username: r.username,
				phone: r.phone,
				company: r.company,
				domain: r.domain,
				status: r.status,
				stage: stageOf(r.status),
				campaignId: r.campaign.id,
				campaignName: r.campaign.name,
				scheduledAt: r.scheduledAt,
				sentAt: r.sentAt,
				readAt: r.readAt,
				repliedAt: r.repliedAt,
				secondSentAt: r.secondSentAt,
				deliveryUnknown: r.deliveryUnknown,
				error: r.error,
				account: r.account,
			})),
		}
	}

	/**
	 * Что происходит с рассылкой сегодня.
	 *
	 * Отдельная сводка, а не выжимка из списка кампаний: главный вопрос к
	 * рассылке — «она сейчас идёт или стоит», и ответ на него не должен
	 * требовать открыть карточку и сложить в уме цифры по аккаунтам.
	 *
	 * Берём кампании, которые идут или стоят на паузе с непустой очередью:
	 * закрытые сегодня уже не касаются, а черновики ещё не начинались.
	 */
	async today() {
		const now = new Date()
		const today = dayKey(now)
		const midnight = startOfDay(now)

		const campaigns = await this.prisma.tgCampaign.findMany({
			where: { status: { in: ['RUNNING', 'PAUSED'] }, archivedAt: null },
			include: { accounts: { include: { account: true } } },
			orderBy: { createdAt: 'desc' },
		})

		const rows = []
		for (const c of campaigns) {
			const [queued, sentToday, blockedToday, plannedToday, next] = await Promise.all([
				this.prisma.tgRecipient.count({ where: { campaignId: c.id, status: 'QUEUED' } }),
				this.prisma.tgRecipient.count({ where: { campaignId: c.id, sentAt: { gte: midnight } } }),
				// Считаем только то, у чего есть отметка времени. У FAILED её нет,
				// и приписывать сегодняшнему дню все прошлые сбои — вранье.
				this.prisma.tgRecipient.count({ where: { campaignId: c.id, blockedAt: { gte: midnight } } }),
				// Запланировано на сегодня — то, что стоит в календаре до конца
				// окна. Именно это число человек видел, когда запускал.
				this.prisma.tgRecipient.count({
					where: {
						campaignId: c.id, status: 'QUEUED',
						scheduledAt: { gte: midnight, lt: windowStart(now, c.windowTo, 0) },
					},
				}),
				this.prisma.tgRecipient.findFirst({
					where: { campaignId: c.id, status: 'QUEUED', scheduledAt: { not: null } },
					orderBy: { scheduledAt: 'asc' },
					select: {
						scheduledAt: true, firstName: true, lastName: true, company: true, username: true, phone: true,
						plannedAccount: { select: { id: true, label: true, avatar: true, tgUserId: true } },
					},
				}),
			])

			// Кампания без единого адресата в очереди и без сегодняшних отправок
			// в сводке «что идёт сегодня» только мешает.
			if (!queued && !sentToday) continue

			rows.push({
				id: c.id,
				name: c.name,
				status: c.status,
				windowFrom: c.windowFrom,
				windowTo: c.windowTo,
				dailyGoal: c.dailyGoal,
				sendDate: dayString(c.sendDate),
				queued,
				sentToday,
				blockedToday,
				plannedToday: plannedToday + sentToday,
				next: next?.scheduledAt
					? {
							at: next.scheduledAt,
							who: [next.firstName, next.lastName].filter(Boolean).join(' ')
								|| next.company
								|| (next.username ? `@${next.username}` : null)
								|| next.phone
								|| 'без имени',
							account: next.plannedAccount,
						}
					: null,
				accounts: c.accounts
					.map(l => ({
						id: l.account.id,
						label: l.account.label,
						avatar: l.account.avatar,
						tgUserId: l.account.tgUserId,
						forceSend: l.account.forceSend,
						sentToday: l.dayKey === today ? l.sentToday : 0,
						dailyLimit: l.dailyLimit ?? null,
						nextSendAt: l.nextSendAt,
						pausedUntil: l.pausedUntil,
						lastError: l.lastError,
					}))
					.sort((a, b) => b.sentToday - a.sentToday),
			})
		}

		const hour = mskHour(now)
		return {
			// Идёт ли отправка прямо сейчас: мало быть запущенной, надо ещё
			// попасть в окно. Вне окна кампания «запущена, но молчит», и это
			// разные вещи, которые нельзя показывать одинаково.
			sending: rows.some(r => r.status === 'RUNNING' && hour >= r.windowFrom && hour < r.windowTo && r.queued > 0),
			now: now.toISOString(),
			campaigns: rows,
			totals: {
				sentToday: rows.reduce((n, r) => n + r.sentToday, 0),
				plannedToday: rows.reduce((n, r) => n + r.plannedToday, 0),
				queued: rows.reduce((n, r) => n + r.queued, 0),
			},
		}
	}

	/**
	 * Итог дня: сколько ушло против плана и почему меньше.
	 *
	 * Вопрос «почему вчера ушло шесть, а не двадцать» до этого нельзя было
	 * задать вовсе: в интерфейсе видно только текущее «сегодня», а разбор
	 * причин каждый раз приходилось делать руками по базе. Причины при этом
	 * всегда одни и те же и все считаются здесь же.
	 *
	 * День — московский: рассылка живёт по московскому окну.
	 */
	async daySummary(date?: string): Promise<{
		date: string
		planned: number
		sent: number
		campaigns: Array<{ id: string; name: string; planned: number; sent: number; reasons: string[] }>
		reasons: string[]
	}> {
		const day = parseDay(date) ?? startOfDay(new Date())
		const from = day
		const to = new Date(day.getTime() + 86400000)
		const key = dayKey(day)

		const campaigns = await this.prisma.tgCampaign.findMany({
			where: { archivedAt: null, status: { in: ['RUNNING', 'PAUSED', 'DONE'] } },
			include: { accounts: { include: { account: { include: { proxy: true } } } } },
		})

		const rows = []
		for (const c of campaigns) {
			const [sent, scheduled] = await Promise.all([
				this.prisma.tgRecipient.count({ where: { campaignId: c.id, sentAt: { gte: from, lt: to } } }),
				this.prisma.tgRecipient.count({
					where: { campaignId: c.id, scheduledAt: { gte: from, lt: to } },
				}),
			])
			// План на день — то, что стояло в календаре, а если календаря нет,
			// то цель дня. Ноль и ноль означает, что кампания в этот день просто
			// не работала, и разбирать нечего.
			const planned = scheduled || (c.sendDate && dayKey(c.sendDate) === key ? (c.dailyGoal ?? 0) : 0)
			if (!planned && !sent) continue

			const reasons: string[] = []
			if (sent < planned) {
				const quota = await this.dailyQuota(c, key)

				// Кто в этот день реально отправлял. Аккаунт, с которого письма
				// ушли, не может быть причиной недобора — что бы ни говорили о
				// нём флаги. Флаг живости прокси, например, показывает результат
				// последней проверки, а не то, работает ли он сейчас.
				const worked = new Set(
					(await this.prisma.tgRecipient.groupBy({
						by: ['accountId'],
						where: { campaignId: c.id, sentAt: { gte: from, lt: to }, accountId: { not: null } },
						_count: { _all: true },
					})).map(g => g.accountId!),
				)

				let working = 0
				for (const l of c.accounts) {
					const a = l.account
					const norm = quota.get(a.id) ?? 0
					if (norm > 0 || worked.has(a.id)) { working++; continue }
					const dead = a.status === 'BANNED' || a.status === 'ERROR' || a.status === 'PAUSED'
					reasons.push(
						dead ? `«${a.label ?? a.id}» — ${a.status === 'PAUSED' ? 'отключён' : 'не в строю'}`
							: a.mode === 'WARM' ? `«${a.label ?? a.id}» — отведён только под прогрев`
								: !a.proxyId ? `«${a.label ?? a.id}» — без прокси`
									: a.proxy && !a.proxy.alive ? `«${a.label ?? a.id}» — по последней проверке прокси не отвечал`
										: `«${a.label ?? a.id}» — прогрев не выдал дневной нормы, и разрешение «без прогрева» не включено`,
					)
				}
				if (!working) reasons.unshift('ни один аккаунт кампании в этот день не мог отправлять')
				else if (working < c.accounts.length) {
					reasons.unshift(`работал ${working} аккаунт из ${c.accounts.length} — весь дневной объём лёг на него`)
				}
				if (c.status === 'PAUSED') reasons.unshift('рассылка стояла на паузе')
			}

			rows.push({ id: c.id, name: c.name, planned, sent, reasons })
		}

		// Общие причины — те, что повторяются у всех кампаний: их и стоит чинить.
		const all = rows.flatMap(r => r.reasons)
		const common = [...new Set(all)]

		return {
			date: key,
			planned: rows.reduce((n, r) => n + r.planned, 0),
			sent: rows.reduce((n, r) => n + r.sent, 0),
			campaigns: rows,
			reasons: common,
		}
	}

	/**
	 * Сообщить в бот, если день закрылся с недобором.
	 *
	 * Раз в сутки и только когда окно уже закрылось: пока оно открыто, отставание
	 * — это не итог, а середина работы. Отметку о том, что за этот день уже
	 * писали, держим в настройках: перезапуск сервиса не должен рождать второе
	 * письмо про те же сутки.
	 */
	async reportDayIfNeeded(): Promise<boolean> {
		const now = new Date()
		const today = dayKey(now)

		const running = await this.prisma.tgCampaign.findMany({
			where: { archivedAt: null, status: { in: ['RUNNING', 'PAUSED'] } },
			select: { windowTo: true },
		})
		if (!running.length) return false
		// Пока хоть у одной кампании окно ещё открыто — день не кончился.
		if (mskHour(now) < Math.max(...running.map(c => c.windowTo))) return false

		const flag = await this.prisma.appConfig.findUnique({ where: { key: KEY_DAY_REPORT } })
		if (flag?.value === today) return false

		const sum = await this.daySummary(today)
		await this.prisma.appConfig.upsert({
			where: { key: KEY_DAY_REPORT },
			create: { key: KEY_DAY_REPORT, value: today },
			update: { value: today },
		})

		// Всё ушло — писать не о чем. Отметку всё равно ставим выше, чтобы не
		// пересчитывать это каждую минуту до полуночи.
		if (!sum.planned || sum.sent >= sum.planned) return false

		const lines = sum.campaigns
			.filter(c => c.sent < c.planned)
			.map(c => `• «${esc(c.name)}» — ушло ${c.sent} из ${c.planned}`)
			.join('\n')

		await this.notifyAdmin(
			`⚠️ <b>Рассылка за день не добрала</b>\n\n` +
				`Ушло <b>${sum.sent}</b> из <b>${sum.planned}</b> запланированных.\n\n` +
				`${lines}\n\n` +
				(sum.reasons.length ? `<b>Почему:</b>\n${sum.reasons.map(r => '— ' + esc(r)).join('\n')}` : ''),
		)
		return true
	}

	/**
	 * Остановить рассылку совсем.
	 *
	 * Тем, кому уже писали, ничего не делаем: переписка и вся статистика по ней
	 * остаются — это история, и стирать её нельзя.
	 *
	 * А вот тех, до кого не дошла очередь, из кампании УБИРАЕМ. Иначе они
	 * заперты навсегда: при наборе новой рассылки отсеивается всякий, кто уже
	 * стоит в списке любой другой кампании, — и отменённая забирала бы полсотни
	 * живых лидов с собой в могилу. Написать им не успели, терять их незачем.
	 *
	 * Этим «Отменить» и отличается от «Паузы»: пауза сохраняет всё и
	 * продолжается одной кнопкой, отмена закрывает рассылку и возвращает
	 * несостоявшихся адресатов в общий котёл.
	 */
	async cancel(campaignId: string) {
		const c = await this.prisma.tgCampaign.findUnique({ where: { id: campaignId }, select: { id: true } })
		if (!c) throw new NotFoundException('Кампания не найдена')

		const released = await this.prisma.tgRecipient.deleteMany({
			where: { campaignId, status: 'QUEUED', sentAt: null },
		})
		await this.prisma.tgCampaign.update({
			where: { id: campaignId },
			data: { status: 'DONE', finishedAt: new Date() },
		})
		return { ok: true, released: released.count }
	}

	/**
	 * Все переписки одного аккаунта, порциями.
	 *
	 * Раньше «с кем этот аккаунт общался» можно было узнать только перебором:
	 * открыть каждую кампанию, найти в списке адресатов тех, у кого стоит этот
	 * аккаунт. А вопрос обычный — особенно когда решаешь, не пора ли аккаунт
	 * менять: сколько ответили, сколько заблокировали.
	 *
	 * Порциями, а не целиком: у рабочего аккаунта переписок сотни, и грузить
	 * их разом незачем — смотрят первые два десятка.
	 */
	async accountDialogs(accountId: string, opts?: { limit?: number; cursor?: string; stage?: string }) {
		const take = Math.max(5, Math.min(100, opts?.limit ?? 25))

		const where: any = { accountId }
		if (STAGE_STATUS[opts?.stage ?? '']) where.status = { in: STAGE_STATUS[opts!.stage!] }

		/*
		 * Курсор по id, а не по времени отправки.
		 *
		 * По времени казалось естественнее — список им и отсортирован, — но
		 * у части строк `sentAt` пустой: так помечаются те, кому написать не
		 * удалось (закрыта приватность, нет такого юзернейма). Условие
		 * `sentAt < курсор` их не проходит вовсе, и до второй страницы они не
		 * доезжали никогда. Порядок сортировки дополнен id, чтобы он был
		 * однозначным и курсор не перескакивал через одинаковые времена.
		 */
		const rows = await this.prisma.tgRecipient.findMany({
			where,
			orderBy: [{ sentAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }, { id: 'desc' }],
			...(opts?.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
			take: take + 1,
			select: {
				id: true, username: true, phone: true, status: true,
				firstName: true, lastName: true, company: true, domain: true,
				sentAt: true, readAt: true, repliedAt: true, secondSentAt: true, blockedAt: true,
				deliveryUnknown: true, error: true,
				campaign: { select: { id: true, name: true } },
				// Последняя реплика: по ней видно, о чём разговор, без открытия.
				messages: { orderBy: { tgId: 'desc' }, take: 1, select: { out: true, text: true, date: true, mediaKind: true } },
				_count: { select: { messages: true } },
			},
		})

		const more = rows.length > take
		const page = more ? rows.slice(0, take) : rows

		const counts = await this.prisma.tgRecipient.groupBy({
			by: ['status'],
			where: { accountId },
			_count: { _all: true },
		})
		const byStatus = new Map(counts.map(c => [String(c.status), c._count._all]))
		const sum = (list: string[]) => list.reduce((n, st) => n + (byStatus.get(st) ?? 0), 0)

		return {
			total: [...byStatus.values()].reduce((a, b) => a + b, 0),
			counts: {
				first: sum(STAGE_STATUS.first),
				second: sum(STAGE_STATUS.second),
				problem: sum(STAGE_STATUS.problem),
				queued: sum(STAGE_STATUS.queued),
				// Отдельно то, ради чего сюда чаще всего и заходят.
				replied: (byStatus.get('REPLIED') ?? 0) + (byStatus.get('SECOND_SENT') ?? 0),
				blocked: byStatus.get('BLOCKED') ?? 0,
			},
			rows: page.map(r => ({
				id: r.id,
				name: [r.firstName, r.lastName].filter(Boolean).join(' ')
					|| r.company
					|| (r.username ? `@${r.username}` : null)
					|| r.phone
					|| 'без имени',
				username: r.username,
				domain: r.domain,
				status: r.status,
				stage: stageOf(r.status),
				campaign: r.campaign,
				sentAt: r.sentAt,
				readAt: r.readAt,
				repliedAt: r.repliedAt,
				secondSentAt: r.secondSentAt,
				blockedAt: r.blockedAt,
				deliveryUnknown: r.deliveryUnknown,
				error: r.error,
				messages: r._count.messages,
				last: r.messages[0] ?? null,
			})),
			// Курсор следующей порции: id последней строки. null — дальше пусто.
			cursor: more ? page[page.length - 1].id : null,
		}
	}

	/**
	 * Закрыть вопрос по отправке с неизвестным исходом — руками.
	 *
	 * Автоматика решает только в положительную сторону: нашли наше сообщение в
	 * переписке — сомнение снято. Обратное («в диалогах не нашли, значит не
	 * дошло») она утверждать не может: getDialogs отдаёт сотню последних, и
	 * отсутствие там ничего не доказывает. Поэтому «всё-таки не дошло» —
	 * решение человека, который открыл Telegram и посмотрел.
	 */
	async resolveDelivery(id: string, delivered: boolean) {
		const r = await this.prisma.tgRecipient.findUnique({
			where: { id },
			select: { id: true, deliveryUnknown: true },
		})
		if (!r) throw new NotFoundException('Адресат не найден')
		if (!r.deliveryUnknown) return { ok: true }

		await this.prisma.tgRecipient.update({
			where: { id },
			data: delivered
				? { deliveryUnknown: false, error: null }
				// Не дошло — возвращаем в очередь, теперь это безопасно:
				// доставку проверил человек.
				: { deliveryUnknown: false, status: 'QUEUED', sentAt: null, sentMsgId: null, accountId: null, error: null },
		})
		return { ok: true, requeued: !delivered }
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
				forceSend: link.account.forceSend,
				forceBlocked: forceable(link.account).why ?? null,
				quotaToday: quota.get(link.account.id) ?? 0,
				// Что стоит в поле ввода (null — «считать самим») и какой у
				// аккаунта потолок: выше него делить бессмысленно.
				dailyLimit: link.dailyLimit ?? null,
				ceiling: Math.max(0, Math.min(c.perAccountPerDay,
					link.account.forceSend ? c.perAccountPerDay : allow.dailyMessages)),
				readiness: allow.readiness,
				allowOutgoing: allow.allowOutgoing,
				notes: allow.notes,
				sentToday: link.dayKey === dayKey(new Date()) ? link.sentToday : 0,
				nextSendAt: link.nextSendAt,
				pausedUntil: link.pausedUntil,
				lastError: link.lastError,
			})
		}

		// Сколько цели дня уже роздано руками и сколько осталось делить.
		const assigned = c.accounts.reduce((n, l) => n + (l.dailyLimit ?? 0), 0)

		const plan = await this.forecast(id)
		const readiness = await this.accountsReadiness(id)
		return {
			id: c.id, name: c.name, status: c.status,
			// Кто из аккаунтов ещё не готов к холодным исходящим и что доделать.
			notWarm: readiness.filter(r => !r.coldReady),
			today: plan.today,
			firstMessage: c.firstMessage, secondMessage: c.secondMessage,
			dailyGoal: c.dailyGoal,
			// День, на который назначена вся очередь.
			sendDate: dayString(c.sendDate),
			// Делёжка цели дня руками: роздано и сколько ещё можно раздать.
			assigned,
			leftToAssign: c.dailyGoal ? Math.max(0, c.dailyGoal - assigned) : null,
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
