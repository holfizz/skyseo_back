// Дедуп списка ключевиков без учёта регистра, сохраняя порядок и первое написание.
export function dedupeKeywords(list: string[]): string[] {
	const seen = new Set<string>()
	const out: string[] = []
	for (const raw of list || []) {
		const k = (raw || '').trim()
		if (!k) continue
		const key = k.toLowerCase()
		if (seen.has(key)) continue
		seen.add(key)
		out.push(k)
	}
	return out
}
