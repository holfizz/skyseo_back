import { getWordstatVolumes, resolveRegion } from '../common/yandex-positions'

/**
 * Частотность запросов по Вордстату для текста холодного сообщения.
 *
 * Ошибки намеренно не пробрасываем: без ключей XMLRiver или при сбое канала
 * возвращается пустая карта, и строка про спрос просто не попадает в текст.
 * Импорт лидов важнее одной цифры.
 */
export async function fetchVolumes(keywords: string[], region: string | null): Promise<Map<string, number>> {
	const user = process.env.XMLRIVER_USER
	const key = process.env.XMLRIVER_KEY
	if (!user || !key || keywords.length === 0) return new Map()
	try {
		const volumes = await getWordstatVolumes({
			user,
			key,
			keywords,
			lr: resolveRegion(region ?? undefined).lr,
		})
		return new Map([...volumes].map(([keyword, v]) => [keyword, v.value]))
	} catch {
		return new Map()
	}
}
