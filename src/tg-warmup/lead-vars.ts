/**
 * Фразы по выдаче лида для текстов рассылки: {позиции}, {конкуренты},
 * {запрос}, {позиция}, {конкурент}.
 *
 * Собираются из тех же данных, что и «полное» второе сообщение (outreach-message.ts):
 * запросы лида в окне позиций, где есть что улучшать, и конкуренты с 9 и 10 мест.
 * Ключ, для которого данных нет, в результат не попадает — тогда
 * missingPlaceholders не даст отправить текст, а не сочинит позиции.
 *
 * Конкуренты идут целым доменом, как и во втором сообщении: по огрызку лид
 * соперника не узнает.
 */

import { displayDomain } from '../common/domain'
import type { MessageCompetitor, MessageKeyword } from '../outreach/outreach-message'

export type LeadVars = Record<string, string>

const SHOWN_KEYWORDS = 2
const SHOWN_COMPETITORS = 2

export function buildLeadVars(keywords: MessageKeyword[], competitors: MessageCompetitor[]): LeadVars {
	const vars: LeadVars = {}

	const shown = keywords.slice(0, SHOWN_KEYWORDS)
	if (shown.length) {
		// Первая позиция со словом «месте», дальше без повтора.
		vars['позиции'] = shown
			.map((k, i) => (i === 0 ? `по «${k.keyword}» вы на ${k.position} месте` : `по «${k.keyword}» на ${k.position}`))
			.join(', ')
		vars['запрос'] = shown[0].keyword
		vars['позиция'] = String(shown[0].position)
	}

	const rivals = competitors.slice(0, SHOWN_COMPETITORS).map(c => displayDomain(c.domain)).filter(Boolean)
	if (rivals.length) {
		vars['конкуренты'] = rivals.join(' и ')
		vars['конкурент'] = rivals[0]
	}

	return vars
}
