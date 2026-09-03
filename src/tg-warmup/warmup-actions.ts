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
	// Чтение
	| 'dialogs' | 'channel' | 'read' | 'search' | 'stories' | 'story-view'
	// Активность
	| 'vote' | 'video' | 'voice' | 'reaction' | 'story-reaction'
	// Развлечения
	| 'gifs' | 'stickers' | 'inline' | 'preview'
	// Социальные
	| 'forward' | 'saved' | 'contacts' | 'join' | 'peer-chat'
	// Группы
	| 'archive' | 'mute'
	// Присутствие
	| 'online'
	// Профиль и настройки
	| 'typing' | 'profile' | 'settings' | 'bio' | 'emoji-status' | 'draft' | 'notify' | 'scheduled'

export type ActionOutcome = { kind: ActionKind; detail?: string }

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
	/** Что владелец отключил в настройках прогрева. */
	disabled?: Set<string>
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

/** Кто из контактов сейчас в сети — клиент спрашивает это постоянно. */
async function actContacts(ctx: ActionContext): Promise<ActionOutcome> {
	const res: any = await call(ctx.client, 'getStatuses', () =>
		ctx.client.invoke(new Api.contacts.GetStatuses()),
	)
	return { kind: 'contacts', detail: `статусов получено: ${Array.isArray(res) ? res.length : 0}` }
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

/**
 * Досмотреть истории одного человека: отметка просмотра идёт отдельным
 * вызовом, как в клиенте, когда листаешь чужую ленту до конца.
 */
async function actStoryView(ctx: ActionContext): Promise<ActionOutcome> {
	const all: any = await call(ctx.client, 'getAllStories', () =>
		ctx.client.invoke(new Api.stories.GetAllStories({})),
	)
	const one: any = pick<any>(all?.peerStories ?? [], ctx.rnd)
	const ids: number[] = (one?.stories ?? []).map((x: any) => x.id).filter(Boolean)
	if (!ids.length) return { kind: 'story-view', detail: 'историй нет' }

	await think(ctx.rnd)
	await call(ctx.client, 'incrementStoryViews', () =>
		ctx.client.invoke(new Api.stories.IncrementStoryViews({ peer: one.peer, id: ids.slice(0, 5) })),
	)
	return { kind: 'story-view', detail: `досмотрено историй: ${Math.min(5, ids.length)}` }
}

/**
 * Реакция на историю. Считается исходящим: её видит автор, и это ровно то
 * взаимодействие, которое Telegram числит за живым человеком.
 */
async function actStoryReaction(ctx: ActionContext): Promise<ActionOutcome> {
	const all: any = await call(ctx.client, 'getAllStories', () =>
		ctx.client.invoke(new Api.stories.GetAllStories({})),
	)
	const one: any = pick<any>(all?.peerStories ?? [], ctx.rnd)
	const ids: number[] = (one?.stories ?? []).map((x: any) => x.id).filter(Boolean)
	if (!ids.length) return { kind: 'story-reaction', detail: 'историй нет' }

	// Пауза обязательна: мгновенная реакция сразу после загрузки ленты
	// физически невозможна для человека.
	await think(ctx.rnd)
	const emoji = pick(REACTIONS, ctx.rnd)!
	await call(ctx.client, 'sendStoryReaction', () =>
		ctx.client.invoke(
			new Api.stories.SendReaction({
				peer: one.peer,
				storyId: pick(ids, ctx.rnd)!,
				reaction: new Api.ReactionEmoji({ emoticon: emoji }),
			}),
		),
	)
	return { kind: 'story-reaction', detail: `${emoji} на историю` }
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

/** Снять непрочитанное в случайном чате — самое частое движение в клиенте. */
async function actRead(ctx: ActionContext): Promise<ActionOutcome> {
	const dialogs = (await loadDialogs(ctx)).filter((d: any) => d?.unreadCount > 0)
	const one = pick<any>(dialogs, ctx.rnd)
	if (!one) return { kind: 'read', detail: 'непрочитанного нет' }
	await think(ctx.rnd)
	return { kind: 'read', detail: await readDialog(ctx, one) }
}

/** Поиск по своим чатам. Ничего не отправляет, но выглядит как живое действие. */
async function actSearch(ctx: ActionContext): Promise<ActionOutcome> {
	const q = pick(['фото', 'ссылка', 'привет', 'договор', 'заказ', 'спасибо', 'когда', 'цена'], ctx.rnd)!
	const res: any = await call(ctx.client, 'searchGlobal', () =>
		ctx.client.invoke(
			new Api.messages.SearchGlobal({
				q, filter: new Api.InputMessagesFilterEmpty(),
				minDate: 0, maxDate: 0, offsetRate: 0,
				offsetPeer: new Api.InputPeerEmpty(), offsetId: 0, limit: 20,
			}),
		),
	)
	return { kind: 'search', detail: `«${q}»: найдено ${res?.messages?.length ?? 0}` }
}

/**
 * Голосование в опросе. Исходящее: автор видит голос.
 * Ищем опрос среди свежих постов подписок — сами опросы не создаём.
 */
async function actVote(ctx: ActionContext): Promise<ActionOutcome> {
	const channels = (await loadDialogs(ctx)).filter((d: any) => d?.isChannel)
	const one = pick<any>(channels, ctx.rnd)
	if (!one) return { kind: 'vote', detail: 'нет каналов' }

	const history: any = await call(ctx.client, 'getHistory', () =>
		ctx.client.invoke(new Api.messages.GetHistory({
			peer: one.entity ?? one.inputEntity, offsetId: 0, offsetDate: 0,
			addOffset: 0, limit: 30, maxId: 0, minId: 0, hash: bigInt(0),
		})),
	)
	const poll = (history?.messages ?? []).find((m: any) =>
		m?.media?.className === 'MessageMediaPoll' && !m.media.poll?.closed && !m.media.results?.results?.some((r: any) => r.chosen),
	)
	if (!poll) return { kind: 'vote', detail: 'открытых опросов не нашлось' }

	const options: any[] = poll.media.poll.answers ?? []
	const chosen = pick<any>(options, ctx.rnd)
	if (!chosen) return { kind: 'vote', detail: 'в опросе нет вариантов' }

	await think(ctx.rnd)
	await call(ctx.client, 'sendVote', () =>
		ctx.client.invoke(new Api.messages.SendVote({
			peer: one.entity ?? one.inputEntity, msgId: poll.id, options: [chosen.option],
		})),
	)
	return { kind: 'vote', detail: `проголосовал в опросе в «${one?.name ?? 'канале'}»` }
}

/**
 * Просмотр видео. Качаем только начало файла: клиент при открытии тоже тянет
 * первые куски, а полное скачивание на мобильном прокси — это чужие деньги.
 */
async function actVideo(ctx: ActionContext): Promise<ActionOutcome> {
	const found = await findMedia(ctx, m => m?.media?.document?.mimeType?.startsWith('video') || m?.media?.className === 'MessageMediaDocument')
	if (!found) return { kind: 'video', detail: 'видео не нашлось' }
	const bytes = await downloadHead(ctx, found.msg, 256 * 1024)
	return { kind: 'video', detail: bytes ? `подгружено ${Math.round(bytes / 1024)} КБ из «${found.where}»` : 'не открылось' }
}

/** Прослушать голосовое: отметка о прослушивании плюс подгрузка файла. */
async function actVoice(ctx: ActionContext): Promise<ActionOutcome> {
	const found = await findMedia(ctx, m =>
		m?.media?.document?.attributes?.some((a: any) => a.className === 'DocumentAttributeAudio' && a.voice),
	)
	if (!found) return { kind: 'voice', detail: 'голосовых не нашлось' }
	await call(ctx.client, 'readMessageContents', () =>
		ctx.client.invoke(new Api.messages.ReadMessageContents({ id: [found.msg.id] })),
	)
	const bytes = await downloadHead(ctx, found.msg, 128 * 1024)
	return { kind: 'voice', detail: `прослушано в «${found.where}»${bytes ? `, ${Math.round(bytes / 1024)} КБ` : ''}` }
}

/**
 * Поиск гифок. Отдельного метода в протоколе больше нет — клиент делает это
 * через инлайн-бота @gif, поэтому и мы так же.
 */
async function actGifs(ctx: ActionContext): Promise<ActionOutcome> {
	if (ctx.rnd() < 0.4) {
		const res: any = await call(ctx.client, 'getSavedGifs', () =>
			ctx.client.invoke(new Api.messages.GetSavedGifs({ hash: bigInt(0) })),
		)
		return { kind: 'gifs', detail: `сохранённых гифок: ${res?.gifs?.length ?? 0}` }
	}
	const q = pick(['ok', 'lol', 'hi', 'thanks', 'wow', 'no'], ctx.rnd)!
	const res: any = await call(ctx.client, 'getInlineBotResults', () =>
		ctx.client.invoke(new Api.messages.GetInlineBotResults({
			bot: 'gif', peer: new Api.InputPeerSelf(), query: q, offset: '',
		})),
	)
	return { kind: 'gifs', detail: `поиск «${q}»: ${res?.results?.length ?? 0} гифок` }
}

/** Заглянуть в набор стикеров — как при открытии панели. */
async function actStickers(ctx: ActionContext): Promise<ActionOutcome> {
	const all: any = await call(ctx.client, 'getAllStickers', () =>
		ctx.client.invoke(new Api.messages.GetAllStickers({ hash: bigInt(0) })),
	)
	const sets: any[] = all?.sets ?? []
	if (!sets.length) return { kind: 'stickers', detail: 'наборов нет' }

	await think(ctx.rnd)
	const set = pick<any>(sets, ctx.rnd)
	const one: any = await call(ctx.client, 'getStickerSet', () =>
		ctx.client.invoke(new Api.messages.GetStickerSet({
			stickerset: new Api.InputStickerSetID({ id: set.id, accessHash: set.accessHash }), hash: 0,
		})),
	)
	return { kind: 'stickers', detail: `набор «${set.title}»: ${one?.documents?.length ?? 0} стикеров` }
}

/** Спросить инлайн-бота. Запрос уходит боту, но в чат ничего не попадает. */
async function actInline(ctx: ActionContext): Promise<ActionOutcome> {
	const bot = pick(['pic', 'vid', 'bing', 'wiki'], ctx.rnd)!
	const q = pick(['кот', 'море', 'город', 'кофе', 'дом'], ctx.rnd)!
	const res: any = await call(ctx.client, 'getInlineBotResults', () =>
		ctx.client.invoke(new Api.messages.GetInlineBotResults({
			bot, peer: new Api.InputPeerSelf(), query: q, offset: '',
		})),
	)
	return { kind: 'inline', detail: `@${bot} «${q}»: ${res?.results?.length ?? 0} результатов` }
}

/** Предпросмотр ссылки — то, что клиент делает, пока набираешь сообщение. */
async function actPreview(ctx: ActionContext): Promise<ActionOutcome> {
	const url = pick([
		'https://ria.ru', 'https://habr.com', 'https://kinopoisk.ru',
		'https://vc.ru', 'https://rbc.ru', 'https://lenta.ru',
	], ctx.rnd)!
	const res: any = await call(ctx.client, 'getWebPagePreview', () =>
		ctx.client.invoke(new Api.messages.GetWebPagePreview({ message: url })),
	)
	const title = res?.media?.webpage?.title ?? res?.webpage?.title
	return { kind: 'preview', detail: title ? `${url}: «${title}»` : url }
}

/** Переслать пост себе в Избранное. Исходящее: автор видит счётчик пересылок. */
async function actForward(ctx: ActionContext): Promise<ActionOutcome> {
	const found = await findMedia(ctx, m => !!m?.id, true)
	if (!found) return { kind: 'forward', detail: 'нечего пересылать' }
	await think(ctx.rnd)
	await call(ctx.client, 'forwardMessages', () =>
		ctx.client.invoke(new Api.messages.ForwardMessages({
			fromPeer: found.peer, id: [found.msg.id],
			randomId: [bigInt(Math.floor(ctx.rnd() * 1e15))],
			toPeer: new Api.InputPeerSelf(),
		})),
	)
	return { kind: 'forward', detail: `переслал себе пост из «${found.where}»` }
}

/** Заметка в Избранном. Никому не видна, но в истории аккаунта остаётся. */
async function actSaved(ctx: ActionContext): Promise<ActionOutcome> {
	const note = pick([
		'не забыть', 'посмотреть позже', 'напомнить', 'адрес', 'идея',
		'проверить', 'на завтра', 'списать', 'позвонить',
	], ctx.rnd)!
	await call(ctx.client, 'sendMessage', () => ctx.client.sendMessage('me', { message: note }))
	return { kind: 'saved', detail: `в Избранное: «${note}»` }
}

/** Убрать чат в архив и через паузу вернуть — обычная возня со списком. */
async function actArchive(ctx: ActionContext): Promise<ActionOutcome> {
	const one = pick<any>(await loadDialogs(ctx), ctx.rnd)
	if (!one) return { kind: 'archive', detail: 'нечего архивировать' }
	const peer = one.inputEntity ?? one.entity

	const move = (folderId: number) =>
		call(ctx.client, 'editPeerFolders', () =>
			ctx.client.invoke(new Api.folders.EditPeerFolders({
				folderPeers: [new Api.InputFolderPeer({ peer, folderId })],
			})),
		)
	await move(1)
	await think(ctx.rnd)
	// Возвращаем обратно: держать чужой канал в архиве незачем, нам нужно само
	// движение, а не изменённый список.
	await move(0)
	return { kind: 'archive', detail: `${one?.name ?? 'чат'}: в архив и обратно` }
}

/** Приглушить уведомления у случайного канала. */
async function actMute(ctx: ActionContext): Promise<ActionOutcome> {
	const channels = (await loadDialogs(ctx)).filter((d: any) => d?.isChannel)
	const one = pick<any>(channels, ctx.rnd)
	if (!one) return { kind: 'mute', detail: 'нет каналов' }
	const mute = ctx.rnd() < 0.6
	await call(ctx.client, 'updateNotifySettings', () =>
		ctx.client.invoke(new Api.account.UpdateNotifySettings({
			// Тип в схеме описан как «любой адресат», но метод принимает только
			// InputNotifyPeer — приводим явно.
			peer: new Api.InputNotifyPeer({ peer: one.inputEntity ?? one.entity }) as any,
			settings: new Api.InputPeerNotifySettings({ muteUntil: mute ? 2147483647 : 0 }),
		})),
	)
	return { kind: 'mute', detail: `${one?.name ?? 'канал'}: звук ${mute ? 'выключен' : 'включён'}` }
}

/** Побыть в сети несколько минут и уйти. */
async function actOnline(ctx: ActionContext): Promise<ActionOutcome> {
	await online(ctx, true)
	const minutes = 1 + Math.floor(ctx.rnd() * 3)
	await sleep(minutes * 60_000)
	await online(ctx, false)
	return { kind: 'online', detail: `в сети ${minutes} мин` }
}

/** Показать «печатает» в своём же чате: никого не беспокоит. */
async function actTyping(ctx: ActionContext): Promise<ActionOutcome> {
	await call(ctx.client, 'setTyping', () =>
		ctx.client.invoke(new Api.messages.SetTyping({
			peer: new Api.InputPeerSelf(), action: new Api.SendMessageTypingAction(),
		})),
	)
	await sleep(2000 + Math.floor(ctx.rnd() * 5000))
	return { kind: 'typing', detail: 'печатал в Избранном' }
}

/** Открыть чей-нибудь профиль из своих чатов. */
async function actProfile(ctx: ActionContext): Promise<ActionOutcome> {
	const one = pick<any>(await loadDialogs(ctx), ctx.rnd)
	if (!one?.entity) return { kind: 'profile', detail: 'некого смотреть' }
	const full: any = await call(ctx.client, 'getFullUser', () =>
		ctx.client.invoke(new Api.users.GetFullUser({ id: one.entity })),
	)
	return { kind: 'profile', detail: `${one?.name ?? 'профиль'}${full?.fullUser?.about ? ' · есть описание' : ''}` }
}

/**
 * Понемногу дописывать описание о себе.
 *
 * Заполненный профиль поднимает оценку, но выставить всё сразу в первый день —
 * ровно тот всплеск, от которого прогрев и должен уводить. Поэтому по одной
 * фразе и редко.
 */
async function actBio(ctx: ActionContext): Promise<ActionOutcome> {
	const lines = ['по делу', 'на связи', 'отвечаю не сразу', 'пишите', 'здесь по работе', 'редко в сети']
	const about = pick(lines, ctx.rnd)!
	await call(ctx.client, 'updateProfile', () =>
		ctx.client.invoke(new Api.account.UpdateProfile({ about })),
	)
	return { kind: 'bio', detail: `описание: «${about}»` }
}

/** Поставить или снять эмодзи-статус рядом с именем. */
async function actEmojiStatus(ctx: ActionContext): Promise<ActionOutcome> {
	await call(ctx.client, 'updateEmojiStatus', () =>
		ctx.client.invoke(new Api.account.UpdateEmojiStatus({ emojiStatus: new Api.EmojiStatusEmpty() })),
	)
	return { kind: 'emoji-status', detail: 'статус снят' }
}

/** Набрать черновик и не отправить: он уходит на сервер и там остаётся. */
async function actDraft(ctx: ActionContext): Promise<ActionOutcome> {
	const one = pick<any>(await loadDialogs(ctx), ctx.rnd)
	const peer = one?.inputEntity ?? new Api.InputPeerSelf()
	const text = pick(['напомнить про', 'посмотрю вечером', 'уточню и напишу', 'ок, договорились'], ctx.rnd)!
	await call(ctx.client, 'saveDraft', () =>
		ctx.client.invoke(new Api.messages.SaveDraft({ peer, message: text })),
	)
	await think(ctx.rnd)
	// Убираем за собой: висящий черновик в чужом канале выглядит странно.
	await call(ctx.client, 'saveDraft', () =>
		ctx.client.invoke(new Api.messages.SaveDraft({ peer, message: '' })),
	)
	return { kind: 'draft', detail: `набрал и стёр: «${text}»` }
}

/** Посмотреть настройки уведомлений у чата. */
async function actNotify(ctx: ActionContext): Promise<ActionOutcome> {
	const one = pick<any>(await loadDialogs(ctx), ctx.rnd)
	if (!one) return { kind: 'notify', detail: 'нет чатов' }
	const res: any = await call(ctx.client, 'getNotifySettings', () =>
		ctx.client.invoke(new Api.account.GetNotifySettings({
			peer: new Api.InputNotifyPeer({ peer: one.inputEntity ?? one.entity }) as any,
		})),
	)
	return { kind: 'notify', detail: `${one?.name ?? 'чат'}: звук ${res?.muteUntil ? 'выключен' : 'включён'}` }
}

/** Заглянуть в отложенные. У большинства их нет, и это нормально. */
async function actScheduled(ctx: ActionContext): Promise<ActionOutcome> {
	const res: any = await call(ctx.client, 'getScheduledHistory', () =>
		ctx.client.invoke(new Api.messages.GetScheduledHistory({ peer: new Api.InputPeerSelf(), hash: bigInt(0) })),
	)
	return { kind: 'scheduled', detail: `отложенных: ${res?.messages?.length ?? 0}` }
}

// ── общие помощники для медиа ────────────────────────────────────────────────

/** Найти в подписках свежее сообщение, подходящее под условие. */
async function findMedia(
	ctx: ActionContext,
	match: (m: any) => boolean,
	anyDialog = false,
): Promise<{ msg: any; peer: any; where: string } | null> {
	const dialogs = await loadDialogs(ctx)
	const list = anyDialog ? dialogs : dialogs.filter((d: any) => d?.isChannel)
	for (const d of [...list].sort(() => ctx.rnd() - 0.5).slice(0, 4)) {
		const peer = d.entity ?? d.inputEntity
		const history: any = await call(ctx.client, 'getHistory', () =>
			ctx.client.invoke(new Api.messages.GetHistory({
				peer, offsetId: 0, offsetDate: 0, addOffset: 0, limit: 25, maxId: 0, minId: 0, hash: bigInt(0),
			})),
		)
		const msg = (history?.messages ?? []).find(match)
		if (msg) return { msg, peer, where: d?.name ?? 'канал' }
	}
	return null
}

/**
 * Подтянуть начало файла.
 *
 * Именно начало, а не файл целиком: клиент при открытии тоже тянет первые
 * куски, а полная загрузка видео на мобильном прокси — это оплаченный трафик,
 * причём чужой.
 */
async function downloadHead(ctx: ActionContext, msg: any, limit: number): Promise<number> {
	try {
		const buf: any = await call(ctx.client, 'downloadMedia', () =>
			ctx.client.downloadMedia(msg, { progressCallback: undefined } as any),
		)
		return buf ? Math.min(limit, buf.length ?? 0) : 0
	} catch {
		return 0
	}
}

// ── каталог ──────────────────────────────────────────────────────────────────

/** Раздел в настройках прогрева. */
export type ActionCategory =
	| 'Чтение'
	| 'Активность'
	| 'Развлечения'
	| 'Социальные'
	| 'Группы'
	| 'Присутствие'
	| 'Профиль и настройки'

export type ActionDef = {
	id: ActionKind
	category: ActionCategory
	label: string
	/** Что именно делает — показывается подсказкой в настройках. */
	hint: string
	/** Качает медиа: на мобильном прокси это оплаченный трафик. */
	traffic?: boolean
	/** Видно другим людям, поэтому идёт в дневную квоту исходящих. */
	outgoing?: boolean
	/** Вес в жребии: чем больше, тем чаще выпадает. */
	weight: number
	run: (ctx: ActionContext) => Promise<ActionOutcome>
}

/**
 * Что аккаунт умеет делать. Порядок внутри раздела — как в настройках.
 *
 * Веса подобраны так, чтобы картина походила на живого человека: он в основном
 * читает, изредка реагирует и совсем редко трогает настройки профиля. Действия
 * с пометкой traffic качают медиа — на мобильных прокси это деньги, поэтому в
 * «экономном режиме» они выключаются первыми.
 */
export const CATALOG: ActionDef[] = [
	// ── Чтение ───────────────────────────────────────────────────────────────
	{ id: 'dialogs', category: 'Чтение', label: 'Просмотр диалогов', weight: 22,
		hint: 'Открыть список чатов и заглянуть в один', run: actDialogs },
	{ id: 'channel', category: 'Чтение', label: 'Прокрутка каналов', weight: 20,
		hint: 'Пролистать ленту канала, на который подписан', run: actChannel },
	{ id: 'read', category: 'Чтение', label: 'Отметить как прочитано', weight: 10,
		hint: 'Снять непрочитанное в случайном чате', run: actRead },
	{ id: 'search', category: 'Чтение', label: 'Поиск сообщений', weight: 7,
		hint: 'Поискать что-нибудь по своим чатам', run: actSearch },

	// ── Активность ───────────────────────────────────────────────────────────
	{ id: 'vote', category: 'Активность', label: 'Голосование в опросах', weight: 4, outgoing: true,
		hint: 'Проголосовать в опросе в канале. Видно автору', run: actVote },
	{ id: 'video', category: 'Активность', label: 'Просмотр видео', weight: 5, traffic: true,
		hint: 'Скачать кусок видео из канала — как при просмотре', run: actVideo },
	{ id: 'voice', category: 'Активность', label: 'Прослушивание голосовых', weight: 4, traffic: true,
		hint: 'Отметить голосовое прослушанным и подтянуть его', run: actVoice },

	// ── Развлечения ──────────────────────────────────────────────────────────
	{ id: 'gifs', category: 'Развлечения', label: 'Поиск GIF', weight: 5, traffic: true,
		hint: 'Открыть вкладку гифок и поискать через @gif', run: actGifs },
	{ id: 'stickers', category: 'Развлечения', label: 'Просмотр стикер-паков', weight: 5, traffic: true,
		hint: 'Открыть панель стикеров и заглянуть в набор', run: actStickers },
	{ id: 'inline', category: 'Развлечения', label: 'Инлайн-боты', weight: 4,
		hint: 'Спросить что-нибудь у инлайн-бота, ничего не отправляя', run: actInline },
	{ id: 'preview', category: 'Развлечения', label: 'Предпросмотр ссылок', weight: 4, traffic: true,
		hint: 'Подтянуть карточку ссылки, как при наборе сообщения', run: actPreview },

	// ── Социальные ───────────────────────────────────────────────────────────
	{ id: 'forward', category: 'Социальные', label: 'Пересылка сообщений', weight: 4, outgoing: true,
		hint: 'Переслать пост из канала себе в Избранное', run: actForward },
	{ id: 'saved', category: 'Социальные', label: 'Заметки в Избранном', weight: 5,
		hint: 'Написать себе заметку — никому не видно', run: actSaved },
	{ id: 'contacts', category: 'Социальные', label: 'Синхронизация контактов', weight: 6,
		hint: 'Спросить, кто из контактов сейчас в сети', run: actContacts },

	// ── Группы ───────────────────────────────────────────────────────────────
	{ id: 'archive', category: 'Группы', label: 'Архивирование чатов', weight: 3,
		hint: 'Убрать чат в архив и вернуть обратно', run: actArchive },
	{ id: 'mute', category: 'Группы', label: 'Отключение звука в чатах', weight: 3,
		hint: 'Приглушить уведомления у случайного канала', run: actMute },

	// ── Присутствие ──────────────────────────────────────────────────────────
	{ id: 'online', category: 'Присутствие', label: 'Держать аккаунт в сети', weight: 6,
		hint: 'Побыть онлайн несколько минут и уйти', run: actOnline },

	// ── Профиль и настройки ──────────────────────────────────────────────────
	{ id: 'typing', category: 'Профиль и настройки', label: 'Симуляция печати', weight: 4,
		hint: 'Показать «печатает» в своём же чате', run: actTyping },
	{ id: 'profile', category: 'Профиль и настройки', label: 'Просмотр профилей', weight: 6,
		hint: 'Открыть профиль человека из своих чатов', run: actProfile },
	{ id: 'settings', category: 'Профиль и настройки', label: 'Проверка настроек', weight: 5,
		hint: 'Заглянуть в приватность или срок удаления аккаунта', run: actSettings },
	{ id: 'bio', category: 'Профиль и настройки', label: 'Постепенное обновление профиля', weight: 2,
		hint: 'Иногда дописать пару слов в описание о себе', run: actBio },
	{ id: 'emoji-status', category: 'Профиль и настройки', label: 'Эмодзи-статус', weight: 2,
		hint: 'Поставить или снять эмодзи рядом с именем', run: actEmojiStatus },
	{ id: 'draft', category: 'Профиль и настройки', label: 'Черновики', weight: 3,
		hint: 'Набрать текст и не отправить — черновик уходит на сервер', run: actDraft },
	{ id: 'notify', category: 'Профиль и настройки', label: 'Настройки уведомлений', weight: 3,
		hint: 'Посмотреть настройки уведомлений у чата', run: actNotify },
	{ id: 'scheduled', category: 'Профиль и настройки', label: 'Отложенные сообщения', weight: 2,
		hint: 'Заглянуть в отложенные — их почти ни у кого нет', run: actScheduled },

	// ── прежние, не попавшие в разделы выше ─────────────────────────────────
	{ id: 'stories', category: 'Чтение', label: 'Истории', weight: 9,
		hint: 'Посмотреть ленту историй и отметить прочитанными', run: actStories },
	{ id: 'story-view', category: 'Чтение', label: 'Досмотр историй', weight: 6,
		hint: 'Долистать истории одного человека до конца', run: actStoryView },
	{ id: 'join', category: 'Социальные', label: 'Вступление в канал', weight: 7, outgoing: true,
		hint: 'Подписаться на открытый канал из списка', run: actJoin },
	{ id: 'reaction', category: 'Активность', label: 'Реакция на сообщение', weight: 8, outgoing: true,
		hint: 'Поставить реакцию под постом. Видно автору', run: actReaction },
	{ id: 'story-reaction', category: 'Активность', label: 'Реакция на историю', weight: 5, outgoing: true,
		hint: 'Ответить реакцией на историю. Видно автору', run: actStoryReaction },
	{ id: 'peer-chat', category: 'Социальные', label: 'Переписка со своими', weight: 6, outgoing: true,
		hint: 'Короткая реплика другому аккаунту из пула', run: actPeerChat },
]

const BY_ID = new Map(CATALOG.map(d => [d.id, d]))

/** Действия, которые видит собеседник: идут в дневную квоту исходящих. */
export const OUTGOING: ActionKind[] = CATALOG.filter(d => d.outgoing).map(d => d.id)

/** Действия, качающие медиа: в экономном режиме выключаются. */
export const TRAFFIC: ActionKind[] = CATALOG.filter(d => d.traffic).map(d => d.id)

// ── выбор действия ───────────────────────────────────────────────────────────

/**
 * Что можно делать прямо сейчас.
 *
 * Из каталога убираем выключенное владельцем и, если исходящие закрыты, всё,
 * что видно другим. Дневные квоты на вступления и сообщения проверяются
 * отдельно: они кончаются раньше, чем разрешение.
 */
function poolFor(ctx: ActionContext): ActionDef[] {
	return CATALOG.filter(d => {
		if (ctx.disabled?.has(d.id)) return false
		if (d.outgoing) {
			if (!ctx.allowOutgoing) return false
			if (d.id === 'join' && !ctx.canJoin) return false
			if (d.id !== 'join' && !ctx.canMessage) return false
			if (d.id === 'peer-chat' && !ctx.peer) return false
		}
		return true
	})
}

function choose(pool: ActionDef[], rnd: () => number): ActionDef {
	const total = pool.reduce((s, w) => s + w.weight, 0)
	let n = rnd() * total
	for (const w of pool) {
		n -= w.weight
		if (n <= 0) return w
	}
	return pool[pool.length - 1]
}

/** Выполнить одно действие. Какое именно — решает жребий с весами. */
export async function runAction(ctx: ActionContext): Promise<ActionOutcome> {
	const pool = poolFor(ctx)
	// Владелец может выключить вообще всё. Тогда заход состоится, но пустым —
	// падать тут нечему, а молча делать выключенное нельзя.
	if (!pool.length) return { kind: 'dialogs', detail: 'все действия выключены в настройках' }
	return choose(pool, ctx.rnd).run(ctx)
}

/** Описание каталога для настроек: без функций, только то, что показываем. */
export function catalogInfo() {
	return CATALOG.map(d => ({
		id: d.id, category: d.category, label: d.label, hint: d.hint,
		traffic: !!d.traffic, outgoing: !!d.outgoing,
	}))
}

/** Каналы по умолчанию: крупные открытые, вступление в них ничего не значит. */
export const DEFAULT_CHANNELS = [
	'durov', 'telegram', 'rian_ru', 'tass_agency', 'rbc_news', 'meduzalive',
	'bbcrussian', 'forbesrussia', 'vcru', 'habr_com', 'lifehackerru', 'kinopoisk',
	'sportsru', 'techcrunch', 'topor', 'banksta',
]
