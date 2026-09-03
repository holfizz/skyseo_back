import { Api, TelegramClient } from 'teleproto'
import { call } from './tg-client'

/**
 * Разговор со @SpamBot — служебным ботом Telegram, который сообщает статус
 * ограничений и через которого подаётся обращение на их снятие.
 *
 * ПОЧЕМУ ЗДЕСЬ НЕТ ЗАШИТОГО СЦЕНАРИЯ. Соблазн был: отправить /start, найти
 * кнопку «This is a mistake», нажать, отправить заготовленный текст. Но текст
 * кнопок у бота локализован, меняется и зависит от того, какое именно
 * ограничение наложено. Захардкоженный сценарий сломается молча и в худший
 * момент — когда аккаунт уже под блоком.
 *
 * Поэтому здесь механика, а не сценарий: прочитать, что бот ответил, вернуть
 * его кнопки как есть, и дать нажать ту, которую выберет человек. Решает
 * владелец, глядя на настоящий текст, а не я, угадывая его заранее.
 *
 * Про слой TL: в 229 кнопки переименованы. Обычные лежат в KeyboardButton,
 * инлайновые — в KeyboardInlineButton, а тип действия вынесен в отдельное
 * поле type (InlineButtonTypeCallback с данными). Старые имена вроде
 * KeyboardButtonCallback в этой версии уже не существуют.
 */

export type SpamButton = {
	index: number
	text: string
	/** callback — нажимается запросом, text — отправкой этого же текста сообщением. */
	kind: 'callback' | 'text' | 'иное'
}

export type SpamAnswer = {
	/** Что ответил бот. */
	text: string
	buttons: SpamButton[]
	/** Разбор ответа: чисто, временное ограничение, вечное или непонятно. */
	state: 'clean' | 'temporary' | 'permanent' | 'unknown'
	msgId: number | null
}

const BOT = 'SpamBot'

/**
 * Разбор ответа бота. Ответы локализованы, поэтому смотрим признаки и по-русски,
 * и по-английски. Когда не поняли — так и говорим, а не выдаём догадку за факт.
 */
export function readState(text: string): SpamAnswer['state'] {
	const t = (text ?? '').toLowerCase()
	if (!t) return 'unknown'

	// Порядок проверок важен, и «чисто» обязано идти ДО «ограничено».
	// Бот пишет «Ваш аккаунт свободен от каких-либо ограничений» — в этой фразе
	// есть слово «ограничений», и поиск подстроки принимал её за ограничение.
	// Здоровый аккаунт помечался как заблокированный и переставал рассылать.
	if (/навсегда|permanently|forever|will not be lifted/.test(t)) return 'permanent'
	if (/свободен от|нет ограничени|без ограничени|no limits|free as a bird|good news/.test(t)) return 'clean'
	// Ограничение бот всегда называет вместе со сроком или прямым «ограничен».
	if (/ограничен\s+(до|на)|limited until|restricted until|заблокирован\s+до/.test(t)) return 'temporary'
	// Отдельный случай: «аккаунт ограничен» без срока.
	if (/(аккаунт|account)[^.!?]{0,40}(ограничен|limited|restricted)/.test(t)) return 'temporary'
	return 'unknown'
}

/** Кнопки последнего сообщения бота — в том виде, в каком он их прислал. */
function readButtons(msg: any): SpamButton[] {
	const markup = msg?.replyMarkup
	const rows: any[] = markup?.rows ?? []
	const out: SpamButton[] = []
	for (const row of rows) {
		for (const b of row?.buttons ?? []) {
			const type = b?.type?.className ?? ''
			out.push({
				index: out.length,
				text: String(b?.text ?? '').trim() || '(без подписи)',
				kind: type.includes('Callback') ? 'callback' : type.includes('Url') ? 'иное' : 'text',
			})
		}
	}
	return out
}

/** Последнее ВХОДЯЩЕЕ сообщение от бота. */
async function lastIncoming(client: TelegramClient, tries = 6): Promise<any | null> {
	for (let i = 0; i < tries; i++) {
		await new Promise<void>(r => setTimeout(r, 2500))
		const msgs: any = await call(client, 'getMessages', () => client.getMessages(BOT, { limit: 5 }))
		const incoming = (msgs ?? []).find((m: any) => m?.message && !m.out)
		if (incoming) return incoming
	}
	return null
}

function answer(msg: any): SpamAnswer {
	const text = String(msg?.message ?? '')
	return { text, buttons: readButtons(msg), state: readState(text), msgId: msg?.id ?? null }
}

/** Спросить статус: /start и прочитать ответ вместе с кнопками. */
export async function askStatus(client: TelegramClient): Promise<SpamAnswer> {
	await call(client, 'sendMessage', () => client.sendMessage(BOT, { message: '/start' }))
	const msg = await lastIncoming(client)
	return msg ? answer(msg) : { text: '', buttons: [], state: 'unknown', msgId: null }
}

/**
 * Нажать кнопку под последним сообщением бота.
 *
 * Инлайновая нажимается запросом обратного вызова, обычная — отправкой её же
 * текста сообщением: у клавиатуры внизу экрана нажатие именно так и устроено.
 */
export async function pressButton(client: TelegramClient, index: number): Promise<SpamAnswer> {
	const msgs: any = await call(client, 'getMessages', () => client.getMessages(BOT, { limit: 5 }))
	const last = (msgs ?? []).find((m: any) => m?.message && !m.out)
	if (!last) throw new Error('Бот пока ничего не ответил — сначала запросите статус')

	const buttons = readButtons(last)
	const target = buttons[index]
	if (!target) throw new Error(`Кнопки №${index + 1} в ответе бота нет`)

	if (target.kind === 'callback') {
		// Ищем данные именно этой кнопки: в SpamButton их не кладём, чтобы
		// наружу не уезжали служебные байты.
		let data: Buffer | null = null
		let i = 0
		for (const row of last.replyMarkup?.rows ?? []) {
			for (const b of row?.buttons ?? []) {
				if (i++ === index) data = b?.type?.data ?? null
			}
		}
		if (!data) throw new Error('У этой кнопки нет данных для нажатия')
		await call(client, 'getBotCallbackAnswer', () =>
			client.invoke(new Api.messages.GetBotCallbackAnswer({ peer: BOT, msgId: last.id, data })),
		)
	} else if (target.kind === 'text') {
		await call(client, 'sendMessage', () => client.sendMessage(BOT, { message: target.text }))
	} else {
		throw new Error('Эта кнопка ведёт на внешнюю ссылку, нажать её отсюда нельзя')
	}

	const msg = await lastIncoming(client)
	return msg ? answer(msg) : { text: '', buttons: [], state: 'unknown', msgId: null }
}

/** Отправить боту произвольный текст: обычно это описание проблемы в обращении. */
export async function sendText(client: TelegramClient, text: string): Promise<SpamAnswer> {
	await call(client, 'sendMessage', () => client.sendMessage(BOT, { message: text }))
	const msg = await lastIncoming(client)
	return msg ? answer(msg) : { text: '', buttons: [], state: 'unknown', msgId: null }
}
