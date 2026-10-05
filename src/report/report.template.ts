import { ReportData, ReportKeyword, ReportCompetitor } from './report.types'
import { C, FONT_BOLD_B64, FONT_REGULAR_B64, LOGO_SVG_B64 } from './report.assets'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export { C, FONT_BOLD_B64, FONT_REGULAR_B64, LOGO_SVG_B64 } from './report.assets'

const esc = (value: unknown): string => String(value ?? '')
	.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
const date = (value: Date | null): string => value
	? value.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
	: 'дата замера не сохранена'
const num = (value: number): string => value.toLocaleString('ru-RU')
const position = (value: number | null): string => value && value > 0 ? String(value) : '—'
const place = (k: ReportKeyword): string => k.position && k.position > 10 ? `ещё ${k.position - 10} поз. до топ-10` : 'топ-10'

// Формы повторяют страницу /services: звезда и квадрат маркируют реальные числа.
const star = `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="m18.7 4.627 2.247 4.31a2.27 2.27 0 0 0 1.686 1.189l4.746.65c2.538.35 3.522 3.479 1.645 5.219l-3.25 2.999a2.23 2.23 0 0 0-.683 2.04l.793 4.398c.441 2.45-2.108 4.36-4.345 3.24l-4.536-2.25a2.28 2.28 0 0 0-2.006 0l-4.536 2.25c-2.238 1.11-4.786-.79-4.345-3.24l.793-4.399c.14-.75-.12-1.52-.682-2.04l-3.251-2.998c-1.877-1.73-.893-4.87 1.645-5.22l4.746-.65a2.23 2.23 0 0 0 1.686-1.189l2.248-4.309c1.144-2.17 4.264-2.17 5.398 0" fill="#c5cbff"/></svg>`
const square = `<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="2" y="2" width="28" height="28" rx="8" fill="#ffe381"/></svg>`
// Та самая скобка из прежнего отчёта; здесь она группирует реальные зоны выдачи.
const brace = `<svg class="brace" viewBox="0 0 16 100" preserveAspectRatio="none" aria-hidden="true"><path d="M14 1 Q6 1 6 12 L6 40 Q6 50 1 50 Q6 50 6 60 L6 88 Q6 99 14 99" fill="none" stroke="#a0b5ff" stroke-width="2" stroke-linecap="round"/></svg>`
function illustration(name: string): string | null {
	try {
		return `data:image/png;base64,${readFileSync(join(process.cwd(), 'src/report/illustrations', name)).toString('base64')}`
	} catch {
		return null // PDF остаётся доступным, если ассеты не были включены в сборку.
	}
}
const searchIllustration = illustration('search-results.png')
const aiIllustration = illustration('ai-sources.png')

type Slide = { eyebrow: string; title: string; body: string; source?: string; mode?: string }
function renderSlide(s: Slide, domain: string): string {
	return `<section class="slide ${s.mode ?? ''}">
		<header><div class="brand"><img src="data:image/svg+xml;base64,${LOGO_SVG_B64}" alt=""/><b>SkySEO</b></div><span>Разбор сайта · ${esc(domain)}</span></header>
		<div class="head"><div class="eyebrow">${esc(s.eyebrow)}</div><h1>${s.title}</h1></div>
		<div class="content">${s.body}</div>
		<footer><span>${s.source ?? 'Сохранённый срез данных, не прогноз результата'}</span></footer>
	</section>`
}
function groupedRivals(items: ReportCompetitor[], from: number, to: number, title: string): string {
	const matches = items.filter(c => c.position >= from && c.position <= to)
	return `<div class="tier">${brace}<div><div class="tierTitle"><b>${title}</b><span>места ${from}–${to}</span></div>
		<div class="tierList">${matches.length ? matches.map(c => `<div><strong>${c.position}</strong><span>${esc(c.domain)}</span></div>`).join('') : '<p>В сохранённых данных нет сайтов этой зоны выше вашего.</p>'}</div></div></div>`
}

export function renderReportHtml(data: ReportData): string {
	const ranked = data.keywords.filter(k => k.position !== null && k.position > 0)
	const top3 = ranked.filter(k => (k.position ?? 99) <= 3).length
	const top10 = ranked.filter(k => (k.position ?? 99) <= 10).length
	const in20 = ranked.filter(k => (k.position ?? 99) > 10 && (k.position ?? 99) <= 20).length
	const beyond20 = ranked.filter(k => (k.position ?? 0) > 20).length
	const shown = ranked.slice(0, 8)
	const measured = `${data.region ? esc(data.region) : 'регион не указан'} · ${date(data.measuredAt)}`
	const focus = [...ranked].filter(k => k.competitors.some(c => c.position > 0 && c.position <= 10))
		.sort((a, b) => (b.volume ?? -1) - (a.volume ?? -1) || (b.position ?? 0) - (a.position ?? 0))[0]
	const rivals = focus?.competitors.filter(c => c.position > 0 && c.position <= 10 && c.position < (focus.position ?? 99))
		.sort((a, b) => a.position - b.position).slice(0, 10) ?? []
	const repeated = new Map<string, { domain: string; count: number }>()
	for (const k of ranked) {
		for (const c of new Map(k.competitors.filter(c => c.position > 0 && c.position <= 10)
			.map(c => [c.domain.toLowerCase(), c])).values()) {
			const key = c.domain.toLowerCase()
			const old = repeated.get(key)
			repeated.set(key, { domain: c.domain, count: (old?.count ?? 0) + 1 })
		}
	}
	const recurring = [...repeated.values()].sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain)).slice(0, 5)
	const withVolume = ranked.filter(k => k.volume !== null && k.volume >= 0).sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))
	const demandRows = withVolume.slice(0, 6)
	const demandTotal = demandRows.reduce((sum, k) => sum + (k.volume ?? 0), 0)
	const maxVolume = Math.max(1, ...demandRows.map(k => k.volume ?? 0))
	const priorities = [...ranked].filter(k => (k.position ?? 0) > 10)
		.sort((a, b) => (b.volume ?? -1) - (a.volume ?? -1) || (a.position ?? 99) - (b.position ?? 99)).slice(0, 3)
	const testKeyword = priorities[0] ?? ranked[0]
	const distribution = [
		{ label: 'Топ-3', count: top3, color: '#1400ff' },
		{ label: '4–10', count: top10 - top3, color: '#a0b5ff' },
		{ label: '11–20', count: in20, color: '#ffe381' },
		{ label: '21+', count: beyond20, color: '#d8d9e1' },
	]
	const slides: Slide[] = []

	slides.push({ eyebrow: 'Разбор сайта', title: `Где сейчас сайт<br><em>${esc(data.domain)}</em>`, mode: 'cover', source: `Яндекс · ${measured}`, body: `
		<div class="coverLayout"><div class="coverLead"><div class="urlbar"><i></i><span>https://${esc(data.domain)}</span></div>
			<p>Позиции, поисковое окружение, спрос и вопросы для следующего шага. Только то, что можно подтвердить сохранёнными данными.</p>
			<div class="coverMeta"><b>${esc(data.companyName || data.domain)}</b><span>${measured}</span><span>${ranked.length} запросов с позицией</span></div></div>
			${searchIllustration ? `<img class="coverIll" src="${searchIllustration}" alt="Иллюстрация поисковой выдачи"/>` : `<div class="shapeStat">${star}<div><strong>${ranked.length}</strong><span>запросов<br>с позицией</span></div></div>`}</div>
		<div class="ribbon"><span>На первой странице <b>${top10}</b></span><span>За первой страницей <b>${ranked.length - top10}</b></span><span>Измерен спрос <b>${withVolume.length}</b></span></div>` })

	if (ranked.length) slides.push({ eyebrow: 'Позиции в Яндексе', title: 'В какой зоне находится сайт', source: `Позиции по ${ranked.length} сохранённым запросам · ${measured}`, body: `
		<div class="mapLead"><div class="shapeSmall">${square}<b>${ranked.length}</b></div><p>Карта показывает распределение только проверенных запросов. Она помогает выбрать, с каких зон начать разговор.</p></div>
		<div class="bandMap">${distribution.map(d => `<div class="band"><div class="bandLabel"><b>${d.label}</b><span>${d.count} запросов</span></div><div class="bandTrack"><i style="width:${ranked.length ? Math.max(2, d.count / ranked.length * 100) : 0}%;background:${d.color}"></i></div></div>`).join('')}</div>
		<div class="insight"><b>${ranked.length - top10} из ${ranked.length}</b><span>проверенных запросов находятся за первой страницей. Это повод разобрать их релевантность и посадочные страницы, а не обещание быстрого роста.</span></div>` })

	if (ranked.length) slides.push({ eyebrow: 'Запросы', title: 'Что видно по конкретным фразам', source: `Срез Яндекса · ${measured} · Частотность — показы, не клики`, body: `
		<div class="tableIntro"><span>Показаны до 8 запросов с сохранённой позицией</span><span>До топ-10 — расстояние в местах, не срок работ</span></div>
		<table><thead><tr><th>Запрос</th><th>Место</th><th>До топ-10</th><th>Показы в месяц</th></tr></thead><tbody>
		${shown.length ? shown.map(k => `<tr><td>${esc(k.keyword)}</td><td class="strong">${position(k.position)}</td><td>${place(k)}</td><td>${k.volume === null ? 'не измерено' : num(k.volume)}</td></tr>`).join('') : '<tr><td colspan="4">По сайту пока нет сохранённых позиций. Сначала согласуем запросы и регион.</td></tr>'}
		</tbody></table>` })

	if (focus) slides.push({ eyebrow: 'Поисковая выдача', title: 'Кто выше по одному запросу', source: `Проверенный запрос · ${measured}`, body: `
		<div class="focusLine"><span>Запрос</span><strong>${esc(focus?.keyword || 'нет запроса с сохранённым списком конкурентов')}</strong><span>сайт: ${position(focus?.position ?? null)}</span></div>
		${focus ? `<div class="tierGrid">${groupedRivals(rivals, 1, 3, 'Верх выдачи')}${groupedRivals(rivals, 4, 10, 'Первая страница')}</div>` : '<div class="empty">Для этого сайта нет сопоставимой выдачи с доменами выше. Нужен новый замер.</div>'}
		<div class="shortNote">Это сайты выше по выбранному запросу. Часть из них может не быть прямыми конкурентами бизнеса.</div>` })

	if (recurring.length) slides.push({ eyebrow: 'Конкуренты', title: 'Какие домены встречаются чаще', source: `Среди ${ranked.length} запросов с позицией · сохранённая выдача`, body: `
		<div class="twoPanel"><div><p class="lede">Один сайт может быть выше по нескольким важным запросам. Смотрим повторяемость, а не один случайный результат.</p>
			<div class="repeatRows">${recurring.length ? recurring.map(r => `<div><span class="rowMark"></span><b>${esc(r.domain)}</b><span>${r.count} запрос${r.count === 1 ? '' : r.count < 5 ? 'а' : 'ов'}</span></div>`).join('') : '<div>Доменов выше в сохранённых данных нет.</div>'}</div></div>
			<div class="sideQuestion"><div class="shapeSmall">${star}<b>?</b></div><h2>Кого вы считаете прямым конкурентом?</h2><p>На созвоне отделим реальные компании от агрегаторов и площадок. Только после этого стоит сравнивать страницы и предложения.</p><div class="sideMetric"><strong>${repeated.size}</strong><span>разных доменов выше по проверенным запросам</span></div></div></div>` })

	if (demandRows.length) slides.push({ eyebrow: 'Поисковый спрос', title: 'Где есть измеренный интерес', source: `Вордстат · ${measured} · Сумма показов не равна аудитории или заявкам`, body: `
		<div class="demandHeader"><div><strong>${demandRows.length ? num(demandTotal) : '—'}</strong><span>сумма показов по ${demandRows.length} показанным фразам</span></div><p>Слова в запросах пересекаются. Это размер выбранного среза спроса, а не число потерянных клиентов.</p></div>
		<div class="volumeRows">${demandRows.length ? demandRows.map(k => `<div><span>${esc(k.keyword)}</span><div class="volumeTrack"><i style="width:${(k.volume ?? 0) / maxVolume * 100}%"></i></div><b>${num(k.volume ?? 0)}</b><small>место ${position(k.position)}</small></div>`).join('') : '<div class="empty">Частотность ещё не получена. На встрече сверим спрос с вашими приоритетными услугами.</div>'}</div>
		${demandRows.length ? `<div class="discussion"><b>Вопрос для вас</b><span>Запрос «${esc(demandRows[0].keyword)}» имеет наибольшую измеренную частотность в этом срезе. Эта услуга для вас приоритетна?</span></div>` : ''}` })

	if (priorities.length) slides.push({ eyebrow: 'Приоритеты', title: 'Какие запросы проверить первыми', source: 'Порядок основан на позиции и доступной частотности; это гипотезы, не готовый аудит', body: `
		<div class="priorityList">${priorities.length ? priorities.map(k => `<div class="priority"><div class="priorityMark">${square}</div><div><h2>${esc(k.keyword)}</h2><p>Место ${position(k.position)} · ${place(k)} · ${k.volume === null ? 'спрос не измерен' : `${num(k.volume)} показов в месяц`}</p></div><span>Проверить страницу<br>и намерение запроса</span></div>`).join('') : '<div class="empty">Запросов за топ-10 в сохранённом срезе нет. Обсудим удержание и новые направления поиска.</div>'}</div>
		<div class="discussion"><b>Вопрос для вас</b><span>Какие из этих направлений дают вам нужных клиентов? От ответа зависит порядок дальнейшей проверки.</span></div>` })

	slides.push({ eyebrow: 'Нейропоиск', title: 'Что пока неизвестно о нейросетях', source: 'Статус видимости в ответах нейросетей в этом разборе не измерен', body: `
		<div class="aiLayout"><div class="aiChecks"><div><span class="aiMark"></span><h2>Сценарии</h2><p>По каким вопросам клиент ищет вашу услугу и в каком регионе?</p></div><div><span class="aiMark"></span><h2>Упоминания</h2><p>Появляется ли бренд в ответах? На каких площадках есть источники?</p></div><div><span class="aiMark"></span><h2>Повторяемость</h2><p>Сохраняется ли результат при повторной проверке по одной методике?</p></div></div>${aiIllustration ? `<img class="aiIll" src="${aiIllustration}" alt="Иллюстрация проверки источников ответа"/>` : ''}</div>
		<div class="aiQuestion">Вы уже проверяли, рекомендуют ли ваш сайт в ответах на такие запросы?</div>
		<div class="shortNote">Без этой проверки нельзя утверждать, что сайт там не виден или что продвижение уже работает.</div>` })

	slides.push({ eyebrow: 'Бесплатный тест сайта', title: 'Что покажут пять дней проверки?', source: 'Повторный замер покажет фактические изменения; рост позиций не гарантирован', body: `
		<div class="testLead"><span>Один из запросов для старта</span><strong>${testKeyword ? esc(testKeyword.keyword) : 'Выберем запросы и снимем исходные позиции'}</strong><small>${measured}</small></div>
		<div class="testCompare"><div><span>Сейчас</span><b>${testKeyword ? position(testKeyword.position) : '—'}</b><small>${testKeyword ? 'место в сохранённом замере' : 'исходный замер ещё нужен'}</small></div><div class="testArrow">→</div><div class="future"><span>После пяти дней</span><b>?</b><small>повторим проверку по той же методике</small></div></div>
		<div class="testSteps"><div><b>Зафиксируем</b><span>запросы, регион и текущие позиции</span></div><div><b>Проверим</b><span>страницы, выдачу и точки роста</span></div><div><b>Покажем</b><span>фактическую динамику и выводы</span></div></div>
		<div class="testCta">Согласуем 2–3 важных запроса и начнём бесплатный тест.</div>` })

	return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>
		@font-face{font-family:Inter;src:url(data:font/woff2;base64,${FONT_REGULAR_B64})} @font-face{font-family:Inter;src:url(data:font/woff2;base64,${FONT_BOLD_B64});font-weight:700}
		@page{size:297mm 167mm;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0;font-family:Inter,Arial,sans-serif;color:${C.dark}}.slide{width:297mm;height:167mm;position:relative;overflow:hidden;padding:13mm 17mm 12mm;background:#fff;page-break-after:always}.slide:last-child{page-break-after:auto}header{height:10mm;display:flex;justify-content:space-between;align-items:center;font-size:9pt;color:${C.muted}}.brand{display:flex;align-items:center;gap:2mm;color:${C.dark};font-size:15pt}.brand img{height:8mm;width:8mm}.head{margin:7mm 0 5mm}.eyebrow{display:inline-block;font-size:9pt;font-weight:700;color:${C.blue};background:#ebecff;border-radius:8mm;padding:1.5mm 3.5mm}h1{font-size:27pt;line-height:1.12;letter-spacing:-.04em;margin:2mm 0 0}h1 em{font-style:normal;color:${C.blue};overflow-wrap:anywhere}.content{height:103mm}.slide.cover .content{height:105mm}footer{position:absolute;bottom:7mm;left:17mm;right:17mm;padding-top:3mm;display:flex;justify-content:space-between;gap:8mm;font-size:7.5pt;color:${C.muted}}footer b{color:${C.dark};white-space:nowrap}h2{font-size:15pt;line-height:1.22;letter-spacing:-.02em;margin:0}p{line-height:1.42}
		.urlbar{background:#ebecf3;border-radius:3mm;padding:3mm 4mm;display:flex;align-items:center;gap:3mm;font-size:11pt;font-weight:700;overflow-wrap:anywhere}.urlbar i{width:2mm;height:2mm;border-radius:50%;background:${C.blue};box-shadow:4mm 0 ${C.periwinkleDeep},8mm 0 ${C.yellow};margin-right:9mm}.coverLayout{display:grid;grid-template-columns:1.5fr .7fr;gap:9mm;align-items:center;height:72mm}.coverIll{display:block;width:76mm;height:66mm;object-fit:contain;justify-self:center}.coverLead p{font-size:14pt;margin:6mm 0;color:${C.muted};max-width:150mm}.coverMeta{display:flex;gap:5mm;font-size:9pt}.coverMeta span{color:${C.muted}}.shapeStat{width:65mm;height:65mm;position:relative}.shapeStat svg{width:100%;height:100%}.shapeStat>div{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;padding-top:4mm}.shapeStat strong{font-size:51pt;line-height:1}.shapeStat span{text-align:center;font-size:9pt}.ribbon{background:#f3f3fa;border-radius:4mm;padding:4mm 5mm;display:grid;grid-template-columns:repeat(3,1fr);gap:5mm;font-size:10pt}.ribbon b{margin-left:2mm;color:${C.blue};font-size:15pt}
		.shapeSmall{width:20mm;height:20mm;position:relative;flex:none}.shapeSmall svg{width:100%;height:100%}.shapeSmall b{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:22pt;padding-top:1mm}.mapLead{display:flex;align-items:center;gap:6mm;margin-bottom:5mm}.mapLead p{font-size:11pt;color:${C.muted};max-width:190mm}.bandMap{display:grid;gap:4mm}.band{display:grid;grid-template-columns:34mm 1fr;gap:6mm;align-items:center}.bandLabel{display:flex;justify-content:space-between;gap:2mm;font-size:10pt}.bandLabel span{font-size:8pt;color:${C.muted};white-space:nowrap}.bandTrack{height:8mm;border-radius:2mm;background:#f0f0f4;overflow:hidden}.bandTrack i{display:block;height:100%;border-radius:2mm}.insight{margin-top:6mm;padding:4mm 5mm;background:#f6f6fa;display:flex;align-items:center;gap:7mm;border-radius:2mm;font-size:9pt}.insight b{font-size:19pt;white-space:nowrap}.insight span{color:${C.muted}}
		.tableIntro{display:flex;justify-content:space-between;margin-bottom:3mm;color:${C.muted};font-size:8pt}table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:9pt}th{text-align:left;background:#ebecf3;padding:2mm 3mm;font-size:8pt;color:${C.muted}}th:nth-child(1){width:48%}th:nth-child(2){width:12%}th:nth-child(3){width:21%}th:nth-child(4){width:19%}td{padding:2mm 3mm;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}td.strong{font-size:12pt;font-weight:700;color:${C.blue}}
		.focusLine{display:flex;align-items:center;gap:4mm;background:${C.periwinkle};border-radius:3mm;padding:3mm 4mm;font-size:9pt}.focusLine strong{flex:1;font-size:13pt;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.focusLine span:last-child{white-space:nowrap}.tierGrid{display:grid;grid-template-columns:1fr 1fr;gap:7mm;margin-top:5mm}.tier{display:grid;grid-template-columns:5mm 1fr;gap:3mm;min-height:67mm}.brace{width:5mm;height:100%}.tierTitle{display:flex;justify-content:space-between;gap:2mm;margin-bottom:2mm;font-size:10pt}.tierTitle span{color:${C.muted};font-size:8pt}.tierList{display:grid;gap:1mm}.tierList>div{display:flex;gap:3mm;align-items:center;background:#ebecf3;border-radius:2mm;padding:1.6mm 3mm;min-height:7mm;font-size:8.5pt}.tierList strong{color:${C.blue};width:6mm}.tierList span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tierList p{color:${C.muted};font-size:9pt}.shortNote{font-size:8pt;color:${C.muted};line-height:1.35;margin-top:4mm}.empty{background:#f4f4f8;border:1px dashed ${C.line};border-radius:3mm;padding:7mm;color:${C.muted};font-size:11pt;line-height:1.4}
		.twoPanel{display:grid;grid-template-columns:1.5fr .8fr;gap:8mm}.lede{font-size:10pt;color:${C.muted};margin:0 0 5mm}.repeatRows{display:grid;gap:2mm}.repeatRows>div{display:flex;align-items:center;gap:4mm;background:#f5f5fa;border-radius:3mm;padding:3.5mm 4mm;font-size:10pt}.repeatRows b{flex:1}.repeatRows span:last-child{font-size:8pt;color:${C.muted}}.rowMark{display:block;width:4mm;height:4mm;border-radius:1.2mm;background:${C.periwinkleDeep};flex:none}.sideQuestion{background:#f6f6fa;border-radius:3mm;padding:6mm;min-height:78mm;display:flex;flex-direction:column}.sideQuestion h2{margin:4mm 0}.sideQuestion p{font-size:9pt;color:${C.muted}}.sideMetric{margin-top:auto;padding-top:4mm;display:flex;align-items:center;gap:3mm}.sideMetric strong{font-size:25pt;color:${C.blue}}.sideMetric span{font-size:8pt;color:${C.muted};line-height:1.3}.demandHeader{display:flex;justify-content:space-between;align-items:end;gap:10mm;margin-bottom:5mm}.demandHeader>div{display:flex;align-items:baseline;gap:4mm}.demandHeader strong{font-size:35pt;color:${C.blue}}.demandHeader span{font-size:9pt;max-width:35mm}.demandHeader p{max-width:110mm;font-size:9pt;color:${C.muted};margin:0}.volumeRows{display:grid;gap:3mm}.volumeRows>div:not(.empty){display:grid;grid-template-columns:65mm 1fr 18mm 20mm;gap:3mm;align-items:center;font-size:8.5pt}.volumeRows span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.volumeRows b{text-align:right}.volumeRows small{color:${C.muted};text-align:right}.volumeTrack{height:5mm;background:#eeeef4;border-radius:1mm;overflow:hidden}.volumeTrack i{height:100%;display:block;background:${C.periwinkleDeep};border-radius:1mm}.discussion{margin-top:6mm;background:${C.yellow};border-radius:3mm;padding:4mm 5mm;display:flex;gap:5mm;align-items:center;font-size:10pt}.discussion b{white-space:nowrap}.discussion span{line-height:1.3}

		.priorityList{display:grid;gap:3mm}.priority{display:grid;grid-template-columns:13mm 1fr 42mm;gap:5mm;align-items:center;background:#f5f5fa;border-radius:3mm;padding:4mm 5mm}.priorityMark svg{display:block;width:10mm;height:10mm}.priority h2{font-size:13pt;max-width:160mm;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.priority p{font-size:9pt;color:${C.muted};margin:1mm 0 0}.priority>span{font-size:8pt;color:${C.blue};line-height:1.35}.aiLayout{display:grid;grid-template-columns:1.5fr .9fr;gap:5mm;align-items:center;min-height:62mm}.aiChecks{display:grid;gap:2mm}.aiChecks>div{display:grid;grid-template-columns:9mm 43mm 1fr;align-items:center;gap:3mm;padding:3mm 4mm;background:#f6f6fa;border-radius:3mm;min-height:18mm}.aiMark{display:block;width:4mm;height:4mm;border-radius:1.2mm;background:${C.periwinkleDeep}}.aiChecks h2{font-size:12pt}.aiChecks p{font-size:8.5pt;color:${C.muted};margin:0}.aiIll{display:block;width:78mm;height:60mm;object-fit:contain}.aiQuestion{background:${C.yellow};border-radius:3mm;padding:6mm;margin-top:5mm;font-size:16pt;font-weight:700}.testLead{display:flex;align-items:baseline;gap:5mm;background:#f5f5fa;border-radius:3mm;padding:4mm 5mm;max-width:240mm}.testLead span{font-size:9pt;color:${C.muted};white-space:nowrap}.testLead strong{font-size:12pt;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.testLead small{font-size:8pt;color:${C.muted};white-space:nowrap}.testCompare{display:grid;grid-template-columns:1fr 12mm 1fr;align-items:center;gap:5mm;margin-top:5mm}.testCompare>div:not(.testArrow){background:#f3f3fa;border-radius:4mm;padding:5mm 7mm;height:41mm;display:flex;flex-direction:column}.testCompare .future{background:#fff1bb!important}.testCompare span{font-size:9pt;color:${C.muted};font-weight:700}.testCompare b{font-size:33pt;line-height:1.05;margin-top:2mm;color:${C.blue}}.testCompare small{font-size:8pt;color:${C.muted};margin-top:auto}.testArrow{text-align:center;font-size:25pt;color:${C.blue}}.testSteps{display:grid;grid-template-columns:repeat(3,1fr);gap:4mm;margin-top:6mm}.testSteps>div{background:#f5f5fa;border-radius:3mm;padding:4mm;display:flex;flex-direction:column;gap:2mm;min-height:20mm}.testSteps b{font-size:10pt}.testSteps span{font-size:8pt;color:${C.muted};line-height:1.3}.testCta{margin-top:5mm;background:${C.periwinkle};border-radius:3mm;padding:4mm 5mm;font-size:12pt;font-weight:700}
	</style></head><body>${slides.map(s => renderSlide(s, data.domain)).join('')}</body></html>`
}
