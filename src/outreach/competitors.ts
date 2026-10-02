import { displayDomain, isHugeSite } from '../common/domain'
import type { MessageCompetitor, MessageKeyword } from './outreach-message'

export type SerpCell = { keyword: string; position: number; domain: string }

const WANT = 2

/**
 * Конкуренты для текста рассылки.
 *
 * Сначала берём тех, что записаны в карточке лида (9 и 10 места), но без
 * сайтов всей страны вроде Авито: это не конкурент. Если осталось меньше двух,
 * добираем из той же выдачи: тех, кто стоит выше лида по его запросам, ближайшие
 * к нему первыми. Сам лид и дубли не берём.
 */
export function pickCompetitors(
	stored: MessageCompetitor[],
	serp: SerpCell[],
	leadDomain: string,
	keywords: MessageKeyword[],
): MessageCompetitor[] {
	const self = displayDomain(leadDomain)
	const out: MessageCompetitor[] = []
	const seen = new Set<string>([self])
	const add = (domain: string, position: number) => {
		const d = displayDomain(domain)
		if (!d || seen.has(d) || isHugeSite(d) || out.length >= WANT) return
		seen.add(d)
		out.push({ domain: d, position })
	}

	for (const c of stored) add(c.domain, c.position)

	if (out.length < WANT) {
		for (const k of keywords) {
			const above = serp
				.filter(r => r.keyword === k.keyword && r.position < k.position)
				.sort((a, b) => b.position - a.position)
			for (const r of above) add(r.domain, r.position)
			if (out.length >= WANT) break
		}
	}
	return out
}
