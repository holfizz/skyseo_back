import { Api, TelegramClient } from 'teleproto'
import bigInt from 'big-integer'
import { call, TgError } from './tg-client'
import { nextLine } from './chatter'

/**
 * Каталог действий прогрева.
 *
 * Одно «действие» из плана — это не один вызов API, а короткая серия шагов с
 * паузами, как у живого человека: зашёл в сеть, открыл список чатов, прочитал
 * один, вышел. Ровные одиночные запросы раз в сорок минут — узнаваемый след.
 *
 * ЧЕГО ЗДЕСЬ НЕТ И ПОЧЕМУ. Рассылки незнакомым людям. Именно за исходящие
 * незнакомцам прилетает PEER_FLOOD, и прогрев, который этим занимается,
 * не греет аккаунт, а сжигает его. Исходящая история набирается двумя
 * безопасными способами: вступления в открытые каналы и реакции в них, плюс
 * переписка между СВОИМИ аккаунтами из пула, если их больше одного.
 */

export type ActionKind =
	| 'dialogs' // зашёл, посмотрел список чатов, прочитал один
	| 'channel' // почитал ленту канала
	| 'stickers' // клиент подтягивает стикеры при запуске
	| 'settings' // заглянул в настройки
	| 'stories' // посмотрел истории
	| 'join' // вступил в канал
	| 'reaction' // поставил реакцию
	| 'peer-chat' // написал своему же аккаунту из пула

export type ActionOutcome = { kind: ActionKind; detail?: string }

/** Что действие делает с точки зрения лимитов. */
export const OUTGOING: ActionKind[] = ['join', 'reaction', 'peer-chat']

export type ActionContext = {
	client: TelegramClient
	rnd: () => number
	/** Публичные каналы, куда можно вступать и что читать. */
	channels: string[]
	/** Открыты ли сегодня исходящие вообще (решает outgoingAllowance). */
	allowOutgoing: boolean
	/** Разрешено ли ещё вступать сегодня (дневная квота не выбрана). */
	canJoin: boolean
	/** Разрешены ли ещё исходящие сообщения сегодня. */
	canMessage: boolean
	/** Юзернейм своего же аккаунта из пула, кому не жалко написать. */
	peer?: string | null
	/** Ключ пары «кто с кем»: от него зависит, какой у них разговор. */
	chatKey?: string
	/** Какая это по счёту реплика в этой паре. */
	chatIndex?: number
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

/** Пауза «человек посмотрел на экран»: от секунды до восьми. */
function think(rnd: () => number): Promise<void> {
	return sleep(1000 + Math.floor(rnd() * 7000))
}

function pick<T>(arr: T[], rnd: () => number): T | undefined {
	return arr.length ? arr[Math.floor(rnd() * arr.length)] : undefined
}

// ── шаги ─────────────────────────────────────────────────────────────────────

async function online(ctx: ActionContext, on: boolean): Promise<void> {
	await call(ctx.client, 'updateStatus', () =>
		ctx.client.invoke(new Api.account.UpdateStatus({ offline: !on })),
	)
}

/** Список диалогов. Возвращаем только то, что пригодно для чтения. */
async function loadDialogs(ctx: ActionContext, limit = 50): Promise<any[]> {
	const res: any = await call(ctx.client, 'getDialogs', () => ctx.client.getDialogs({ limit }))
	return Array.isArray(res) ? res : (res?.dialogs ?? [])
}

/** Открыть диалог: подтянуть историю и отметить прочитанным. */
async function readDialog(ctx: ActionContext, dialog: any): Promise<string> {
	const entity = dialog?.entity ?? dialog?.inputEntity
	if (!entity) throw new TgError({ kind: 'other', message: 'у диалога нет собеседника' })

	const history: any = await call(ctx.client, 'getHistory', () =>
		ctx.client.invoke(
			new Api.messages.GetHistory({
				peer: entity,
				offsetId: 0,
				offsetDate: 0,
				addOffset: 0,
				limit: 10 + Math.floor(ctx.rnd() * 20),
				maxId: 0,
				minId: 0,
				hash: bigInt(0),
			}),
		),
	)
	await think(ctx.rnd)

	const messages: any[] = history?.messages ?? []
	const top = messages[0]?.id
	if (top) {
		await call(ctx.client, 'readHistory', () =>
			ctx.client.invoke(new Api.messages.ReadHistory({ peer: entity, maxId: top })),
		)
	}
	return `${dialog?.name ?? dialog?.title ?? 'диалог'}: ${messages.length} сообщ.`
}

// ── действия ─────────────────────────────────────────────────────────────────

async function actDialogs(ctx: ActionContext): Promise<ActionOutcome> {
	await online(ctx, true)
	await think(ctx.rnd)
	const dialogs = await loadDialogs(ctx)
	let detail = `чатов: ${dialogs.length}`
	const one = pick(dialogs, ctx.rnd)
	if (one) {
		await think(ctx.rnd)
		detail += `, открыт ${await readDialog(ctx, one)}`
	}
	await think(ctx.rnd)
	await online(ctx, false)
	return { kind: 'dialogs', detail }
}

async function actChannel(ctx: ActionContext): Promise<ActionOutcome> {
	await online(ctx, true)
	const dialogs = await loadDialogs(ctx)
	const channels = dialogs.filter(d => d?.isChannel || d?.entity?.className === 'Channel')
	if (!channels.length) {
		// Каналов ещё нет — вместо холостого хода читаем что есть.
		await online(ctx, false)
		return actDialogs(ctx)
	}
	await think(ctx.rnd)
	const detail = await readDialog(ctx, pick(channels, ctx.rnd))
	await think(ctx.rnd)
	await online(ctx, false)
	return { kind: 'channel', detail }
}

async function actStickers(ctx: ActionContext): Promise<ActionOutcome> {
	const res: any = await call(ctx.client, 'getAllStickers', () =>
		ctx.client.invoke(new Api.messages.GetAllStickers({ hash: bigInt(0) })),
	)
	return { kind: 'stickers', detail: `наборов: ${res?.sets?.length ?? 0}` }
}

async function actSettings(ctx: ActionContext): Promise<ActionOutcome> {
	// Что именно смотрит человек — не важно, важно что заходы разные.
	if (ctx.rnd() < 0.5) {
		const res: any = await call(ctx.client, 'getPrivacy', () =>
			ctx.client.invoke(new Api.account.GetPrivacy({ key: new Api.InputPrivacyKeyStatusTimestamp() })),
		)
		return { kind: 'settings', detail: `правил приватности: ${res?.rules?.length ?? 0}` }
	}
	const ttl: any = await call(ctx.client, 'getAccountTTL', () =>
		ctx.client.invoke(new Api.account.GetAccountTTL()),
	)
	return { kind: 'settings', detail: `удаление через ${ttl?.days ?? '?'} дн.` }
}

async function actStories(ctx: ActionContext): Promise<ActionOutcome> {
	const all: any = await call(ctx.client, 'getAllStories', () =>
		ctx.client.invoke(new Api.stories.GetAllStories({})),
	)
	const peers: any[] = all?.peerStories ?? []
	if (!peers.length) return { kind: 'stories', detail: 'историй нет' }

	await think(ctx.rnd)
	const one = pick(peers, ctx.rnd)
	const ids: number[] = (one?.stories ?? []).map((s: any) => s.id).filter(Boolean)
	if (!ids.length) return { kind: 'stories', detail: 'историй нет' }

	// Отметка о просмотре — то же самое, что делает клиент при пролистывании.
	await call(ctx.client, 'readStories', () =>
		ctx.client.invoke(new Api.stories.ReadStories({ peer: one.peer, maxId: Math.max(...ids) })),
	)
	return { kind: 'stories', detail: `просмотрено историй: ${ids.length}` }
}

async function actJoin(ctx: ActionContext): Promise<ActionOutcome> {
	const dialogs = await loadDialogs(ctx)
	const known = new Set(
		dialogs.map(d => String(d?.entity?.username ?? '').toLowerCase()).filter(Boolean),
	)
	const candidates = ctx.channels
		.map(c => c.replace(/^@/, '').trim())
		.filter(c => c && !known.has(c.toLowerCase()))
	const target = pick(candidates, ctx.rnd)
	if (!target) return { kind: 'join', detail: 'вступать некуда: список каналов исчерпан' }

	await think(ctx.rnd)
	// Резолв отдельным шагом — человек сначала открывает канал, потом жмёт «вступить».
	const resolved: any = await call(ctx.client, 'resolveUsername', () =>
		ctx.client.invoke(new Api.contacts.ResolveUsername({ username: target })),
	)
	await think(ctx.rnd)
	await call(ctx.client, 'joinChannel', () =>
		ctx.client.invoke(new Api.channels.JoinChannel({ channel: resolved?.peer ?? target })),
	)
	return { kind: 'join', detail: `@${target}` }
}

// Реакции берём только положительные и только ходовые: экзотика в канале,
// где её никто не ставит, заметнее, чем отсутствие реакции.
const REACTIONS = ['👍', '❤️', '🔥', '👏', '🙏']

async function actReaction(ctx: ActionContext): Promise<ActionOutcome> {
	const dialogs = await loadDialogs(ctx)
	const channels = dialogs.filter(d => d?.isChannel || d?.entity?.className === 'Channel')
	const one = pick(channels, ctx.rnd)
	if (!one) return { kind: 'reaction', detail: 'нет каналов, где ставить реакцию' }

	const entity = one.entity ?? one.inputEntity
	const history: any = await call(ctx.client, 'getHistory', () =>
		ctx.client.invoke(
			new Api.messages.GetHistory({
				peer: entity, offsetId: 0, offsetDate: 0, addOffset: 0, limit: 15, maxId: 0, minId: 0, hash: bigInt(0),
			}),
		),
	)
	const messages: any[] = (history?.messages ?? []).filter((m: any) => m?.id)
	const msg = pick(messages, ctx.rnd)
	if (!msg) return { kind: 'reaction', detail: 'в канале нет сообщений' }

	// Пауза перед реакцией обязательна: мгновенный лайк после загрузки ленты
	// физически невозможен для человека.
	await think(ctx.rnd)
	const emoji = pick(REACTIONS, ctx.rnd)!
	await call(ctx.client, 'sendReaction', () =>
		ctx.client.invoke(
			new Api.messages.SendReaction({
				peer: entity,
				msgId: msg.id,
				reaction: [new Api.ReactionEmoji({ emoticon: emoji })],
			}),
		),
	)
	return { kind: 'reaction', detail: `${emoji} в ${one?.name ?? 'канале'}` }
}

async function actPeerChat(ctx: ActionContext): Promise<ActionOutcome> {
	if (!ctx.peer) return { kind: 'peer-chat', detail: 'некому писать: в пуле один аккаунт' }

	// Реплику собирает генератор, а не выбирает из списка: пара аккаунтов на
	// долгом прогреве иначе слала бы друг другу одно и то же по кругу, а это
	// заметнее молчания. Продолжаем разговор от последней реплики собеседника.
	const last = await lastIncomingRole(ctx)
	const { text } = nextLine(ctx.chatKey ?? 'pool', ctx.chatIndex ?? 0, last)

	// Печать перед отправкой: клиент всегда шлёт setTyping, и её отсутствие —
	// признак автоматизации ровно так же, как мгновенный ответ.
	await call(ctx.client, 'setTyping', () =>
		ctx.client.invoke(
			new Api.messages.SetTyping({ peer: ctx.peer!, action: new Api.SendMessageTypingAction() }),
		),
	)
	await sleep(1500 + Math.floor(ctx.rnd() * 4000))
	await call(ctx.client, 'sendMessage', () => ctx.client.sendMessage(ctx.peer!, { message: text }))
	return { kind: 'peer-chat', detail: `${ctx.peer}: «${text}»` }
}

/**
 * Чем была последняя реплика собеседника: на вопрос надо отвечать, а не
 * здороваться в третий раз. Определяем грубо, по знаку вопроса и первым словам —
 * этого хватает, чтобы разговор не рассыпался на несвязанные фразы.
 */
async function lastIncomingRole(ctx: ActionContext) {
	if (!ctx.peer) return undefined
	try {
		const msgs: any = await call(ctx.client, 'getMessages', () =>
			ctx.client.getMessages(ctx.peer!, { limit: 3 }),
		)
		const incoming = (msgs ?? []).find((m: any) => m?.message && !m.out)
		if (!incoming) return undefined
		const t = String(incoming.message).toLowerCase()
		if (t.includes('?')) return 'вопрос' as const
		if (/^(привет|здорово|ку|о, привет)/.test(t)) return 'начало' as const
		if (/^(до связи|давай|пока|спишемся|бывай)/.test(t)) return 'конец' as const
		if (/^(да|ага|угу|нет|вроде|похоже|почти|думаю|скорее|пока нет|ещё нет|вряд|не )/.test(t)) return 'ответ' as const
		return 'реакция' as const
	} catch {
		return undefined
	}
}

// ── выбор действия ───────────────────────────────────────────────────────────

type Weighted = { kind: ActionKind; weight: number }

/**
 * Веса действий.
 *
 * Читающие есть всегда — это основа прогрева и самое безопасное, что бывает.
 * Исходящие подмешиваются, только если их разрешил outgoingAllowance: он
 * смотрит на возраст, выдержку, наработку, обжитость, профиль и чистоту
 * разом, а не на одну лишь стадию.
 */
function poolFor(ctx: ActionContext): Weighted[] {
	const read: Weighted[] = [
		{ kind: 'dialogs', weight: 34 },
		{ kind: 'channel', weight: 30 },
		{ kind: 'stories', weight: 14 },
		{ kind: 'settings', weight: 12 },
		{ kind: 'stickers', weight: 10 },
	]
	if (!ctx.allowOutgoing) return read

	const write: Weighted[] = []
	if (ctx.canJoin) write.push({ kind: 'join', weight: 10 })
	if (ctx.canMessage) {
		write.push({ kind: 'reaction', weight: 12 })
		if (ctx.peer) write.push({ kind: 'peer-chat', weight: 8 })
	}
	return [...read, ...write]
}

function choose(pool: Weighted[], rnd: () => number): ActionKind {
	const total = pool.reduce((s, w) => s + w.weight, 0)
	let n = rnd() * total
	for (const w of pool) {
		n -= w.weight
		if (n <= 0) return w.kind
	}
	return pool[pool.length - 1].kind
}

const RUNNERS: Record<ActionKind, (ctx: ActionContext) => Promise<ActionOutcome>> = {
	dialogs: actDialogs,
	channel: actChannel,
	stickers: actStickers,
	settings: actSettings,
	stories: actStories,
	join: actJoin,
	reaction: actReaction,
	'peer-chat': actPeerChat,
}

/** Выполнить одно действие плана. Какое именно — решает жребий с весами. */
export async function runAction(ctx: ActionContext): Promise<ActionOutcome> {
	const kind = choose(poolFor(ctx), ctx.rnd)
	return RUNNERS[kind](ctx)
}

/** Каналы по умолчанию: крупные открытые, вступление в них ничего не значит. */
export const DEFAULT_CHANNELS = [
	'durov', 'telegram', 'rian_ru', 'tass_agency', 'rbc_news', 'meduzalive',
	'bbcrussian', 'forbesrussia', 'vcru', 'habr_com', 'lifehackerru', 'kinopoisk',
	'sportsru', 'techcrunch', 'topor', 'banksta',
]
