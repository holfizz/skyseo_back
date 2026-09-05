/**
 * Вложения из переписки: что именно прислали и стоит ли это тащить.
 *
 * Человек часто отвечает не словами: присылает фото товара, скриншот, стикер
 * или гифку. До этого в ленте на их месте стояло «[вложение без текста]» —
 * видно, что что-то есть, но не видно что, и приходилось лезть в Telegram.
 *
 * Мелкое забираем сразу при опросе и кладём в базу как data-URI: картинки и
 * стикеры весят десятки килобайт, зато потом показываются мгновенно и без
 * похода в Telegram на каждый просмотр. Крупное не тащим совсем — у него
 * остаются вид, имя и размер, и это честнее, чем качать чужое видео на
 * мобильный прокси ради превью.
 */

/** Виды вложений, которые различаем. */
export type MediaKind = 'photo' | 'sticker' | 'gif' | 'video' | 'voice' | 'audio' | 'document' | 'other'

export type MediaInfo = {
	kind: MediaKind
	name: string | null
	size: number | null
	mime: string | null
}

/** Больше этого не тянем: в базе такому не место. */
export const MEDIA_LIMIT = 1_200_000

/** Читаемый размер: «340 КБ», «4.2 МБ». */
export function humanSize(bytes: number | null | undefined): string {
	if (!bytes || bytes < 0) return ''
	if (bytes < 1024) return `${bytes} Б`
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`
	return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`
}

/** Человеческое название вида — для подписи в ленте. */
export const KIND_LABEL: Record<MediaKind, string> = {
	photo: 'Фото',
	sticker: 'Стикер',
	gif: 'Гифка',
	video: 'Видео',
	voice: 'Голосовое',
	audio: 'Аудио',
	document: 'Файл',
	other: 'Вложение',
}

/** Атрибут документа по имени класса: у разных версий схемы они одинаковы. */
function attrs(doc: any): any[] {
	return Array.isArray(doc?.attributes) ? doc.attributes : []
}

function attrName(doc: any): string | null {
	const a = attrs(doc).find(x => x?.className === 'DocumentAttributeFilename')
	return a?.fileName ? String(a.fileName) : null
}

/**
 * Что за вложение в сообщении. null — вложения нет.
 *
 * Порядок проверок не случайный: стикер и гифка — это тоже документы, и если
 * сначала спросить «документ ли это», они оба превратятся в безымянный файл.
 */
export function mediaOf(msg: any): MediaInfo | null {
	const media = msg?.media
	if (!media) return null

	if (media.className === 'MessageMediaPhoto' || media.photo) {
		return { kind: 'photo', name: null, size: null, mime: 'image/jpeg' }
	}

	const doc = media.document
	if (!doc) {
		// Опрос, гео, контакт и прочее без файла: показывать нечего, но и
		// делать вид, что сообщение пустое, нельзя.
		return { kind: 'other', name: null, size: null, mime: null }
	}

	const mime = doc.mimeType ? String(doc.mimeType) : null
	const size = Number(doc.size ?? 0) || null
	const name = attrName(doc)
	const has = (cls: string) => attrs(doc).some(a => a?.className === cls)

	if (has('DocumentAttributeSticker')) return { kind: 'sticker', name, size, mime }
	if (has('DocumentAttributeAnimated')) return { kind: 'gif', name, size, mime }
	if (has('DocumentAttributeVideo')) return { kind: 'video', name, size, mime }
	if (has('DocumentAttributeAudio')) {
		const a = attrs(doc).find(x => x?.className === 'DocumentAttributeAudio')
		return { kind: a?.voice ? 'voice' : 'audio', name, size, mime }
	}
	if (mime?.startsWith('image/')) return { kind: 'photo', name, size, mime }
	return { kind: 'document', name, size, mime }
}

/**
 * Показываем ли вложение целиком.
 *
 * Картинки, стикеры и короткие гифки — да, ради них всё и делается. Видео,
 * голосовые и файлы — нет: их не посмотришь одной строкой в ленте, а весят
 * они столько, что база распухнет на ровном месте.
 */
export function worthDownloading(m: MediaInfo): boolean {
	if (m.kind === 'photo' || m.kind === 'sticker') return (m.size ?? 0) <= MEDIA_LIMIT
	if (m.kind === 'gif') return (m.size ?? 0) > 0 && m.size! <= MEDIA_LIMIT
	return false
}

/** Подпись вместо текста, когда его нет. */
export function mediaCaption(m: MediaInfo): string {
	const size = humanSize(m.size)
	const name = m.name ? ` «${m.name}»` : ''
	return `[${KIND_LABEL[m.kind]}${name}${size ? `, ${size}` : ''}]`
}

/** Тип для data-URI: у стикеров он webp, у гифок mp4. */
export function mimeFor(m: MediaInfo): string {
	if (m.mime) return m.mime
	if (m.kind === 'sticker') return 'image/webp'
	if (m.kind === 'gif') return 'video/mp4'
	return 'image/jpeg'
}
