import { hasSenderGender, type SenderGender } from './sender-voice'
import { containsDomainOrUrl, domainName } from '../common/domain'
import { normalizeName } from '../common/normalize-name'
import type { MessageCompetitor, MessageKeyword } from '../outreach/outreach-message'

/** Keep actual best ranks, including top-10. Never substitute a worse page's rank. */
export function followUpKeywords(rows: MessageKeyword[]): MessageKeyword[] {
	const best = new Map<string, MessageKeyword>()
	for (const row of rows) {
		if (!row.keyword.trim() || containsDomainOrUrl(row.keyword) || !Number.isInteger(row.position) || row.position < 1) continue
		const old = best.get(row.keyword)
		if (!old || row.position < old.position) best.set(row.keyword, row)
	}
	const priority = (p: number) => p >= 10 && p <= 50 ? 0 : p > 1 ? 1 : 2
	return [...best.values()].sort((a, b) => priority(a.position) - priority(b.position) || a.position - b.position || a.keyword.localeCompare(b.keyword)).slice(0, 2)
}

export function personalFollowUp(input: {
	domain: string; firstName?: string | null; middleName?: string | null;
	keywords: MessageKeyword[]; competitors: MessageCompetitor[]; senderGender?: SenderGender;
}): string | null {
	const gender = input.senderGender ?? 'MALE'
	if (!hasSenderGender(gender)) return null
	const site = domainName(input.domain), keywords = followUpKeywords(input.keywords)
	if (!site || !keywords.length) return null
	const name = [input.firstName, input.middleName].map(normalizeName).filter(Boolean).join(' ')
	const positions = keywords.map((k, i) => `по «${k.keyword}» ${i ? 'на' : 'вы на'} ${k.position}${i ? '' : ' месте'}`).join(', ')
	// Tie the comparison to the first displayed keyword, not a different query.
	const rivals = [...new Set(input.competitors.filter(c => Number.isInteger(c.position) && c.position > 0 && c.position < keywords[0].position).map(c => domainName(c.domain)))].filter(d => d && d !== site).slice(0, 2)
	const text = [
		name ? `${name}, добрый день.` : 'Здравствуйте.',
		`Правильно понимаю, что хотелось бы получать с ${site} больше заявок из поиска?`,
		`${gender === 'FEMALE' ? 'Посмотрела' : 'Посмотрел'} сайт в Яндексе: ${positions}.${rivals.length ? ` По «${keywords[0].keyword}» выше вас ${rivals.join(' и ')}.` : ''}`,
		'Занимаюсь SEO и продвижением в нейросетях. Могу на коротком созвоне показать позиции сайта, конкурентов и что можно улучшить в первую очередь.',
		'Удобно будет на 10-15 минут созвониться?',
	].join('\n\n').replace(/ё/g, 'е').replace(/Ё/g, 'Е').replace(/[—–]/g, '-')
	return !containsDomainOrUrl(text) ? text : null
}
