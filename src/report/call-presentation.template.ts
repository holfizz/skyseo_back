import { FONT_BOLD_B64, FONT_REGULAR_B64, LOGO_SVG_B64 } from './report.assets'
import { ReportCompetitor, ReportData, ReportKeyword } from './report.types'

// Девять стабильных слайдов для разговора с владельцем. Их номера совпадают
// с подсказками в панели «Созвон»; публичный старый отчёт остаётся отдельным.
const esc = (value: unknown): string => String(value ?? '')
	.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
const date = (value: Date | null): string => value
	? value.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Moscow' })
	: 'дата замера не сохранена'
const pos = (value: number | null): string => value !== null && value > 0 ? String(value) : '—'
const star = '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 1l5.4 17.6L47 24l-17.6 5.4L24 47l-5.4-17.6L1 24l17.6-5.4Z" fill="#c7cdff"/></svg>'
const marketplace = /(^|\.)(avito\.ru|profi\.ru|2gis\.ru|yell\.ru|flamp\.ru|zoon\.ru|otzovik\.com|uslugi\.yandex\.ru)$/i
// Это только порядок примеров для обсуждения, не оценка ценности запроса.
const intentScore = (keyword: string): number =>
	/(заказать|вызвать|купить|приобрести|нанять|записаться|оформить)/i.test(keyword) ? 2
		: /(цена|стоимость|аренда|доставка|услуги)/i.test(keyword) ? 1 : 0

function slide(n: number, domain: string, eyebrow: string, title: string, body: string, takeaway: string, dark = false): string {
	return `<section class="slide${dark ? ' dark' : ''}"><header><div class="brand"><img src="data:image/svg+xml;base64,${LOGO_SVG_B64}" alt=""/><b>SkySEO</b></div><span>Разбор сайта · ${esc(domain)}</span></header>
		<div class="heading"><span class="eyebrow">${esc(eyebrow)}</span><h1>${title}</h1></div>
		<div class="body">${body}</div><div class="takeaway">${takeaway}</div>
		<footer><span>Сохранённый срез поиска · выводы требуют проверки с бизнесом</span><span>${n} / 9</span></footer></section>`
}

function keywordCard(k: ReportKeyword | undefined): string {
	return `<div class="hot"><span>${k ? `«${esc(k.keyword)}»` : 'Запрос выберем вместе'}</span><strong>${pos(k?.position ?? null)}</strong><small>${k ? 'место в сохранённом замере' : 'позиция не сохранена'}</small></div>`
}

function competitorRow(item: ReportCompetitor): string {
	return `<div class="serp-row"><b>${item.position}</b><span>${esc(item.domain)}</span><small>${marketplace.test(item.domain) ? 'площадка' : 'сайт в выдаче'}</small></div>`
}

export function renderCallPresentationHtml(data: ReportData): string {
	const ranked = [...data.keywords].filter(k => k.position !== null && k.position > 0)
		.sort((a, b) => (a.position ?? 99) - (b.position ?? 99))
	const top10 = ranked.filter(k => (k.position ?? 99) <= 10).length
	const eleven20 = ranked.filter(k => (k.position ?? 0) > 10 && (k.position ?? 99) <= 20).length
	const twentyPlus = ranked.filter(k => (k.position ?? 0) > 20).length
	const beyond = ranked.filter(k => (k.position ?? 0) > 10)
	const priorities = [...(beyond.length ? beyond : ranked)]
		.sort((a, b) => intentScore(b.keyword) - intentScore(a.keyword) || (a.position ?? 99) - (b.position ?? 99))
		.slice(0, 3)
	const focus = priorities.find(k => k.competitors.some(c => c.position > 0 && c.position < (k.position ?? 99)))
		?? ranked.find(k => k.competitors.some(c => c.position > 0 && c.position < (k.position ?? 99)))
	const rivals = (focus?.competitors ?? []).filter(c => c.position > 0 && c.position < (focus?.position ?? 99))
		.sort((a, b) => a.position - b.position).slice(0, 6)
	const region = data.region ? esc(data.region) : 'регион не указан'
	const measured = `${region} · замер ${date(data.measuredAt)}`
	const domain = esc(data.domain)
	const rankNote = ranked.length
		? `В сохранённом замере ${ranked.length} запросов, ${ranked.length - top10} за пределами топ-10.`
		: 'По сайту нет сохранённых позиций. На встрече согласуем запросы и регион.'
	const cards = Array.from({ length: 3 }, (_, index) => keywordCard(priorities[index])).join('')
	const table = ranked.length
		? ranked.slice(0, 10).map(k => `<div class="query-row"><span>${esc(k.keyword)}</span><b>${pos(k.position)}</b><small>${(k.position ?? 99) <= 10 ? 'топ-10' : 'за 1-й страницей'}</small></div>`).join('')
		: '<div class="empty">Позиции не сохранены. Прежде чем обсуждать конкурентов, зафиксируем нужные запросы и регион.</div>'
	const focusName = focus ? `«${esc(focus.keyword)}»` : 'Запрос ещё не выбран'
	const compare = priorities.length ? priorities.map(k => pos(k.position)).join(' / ') : '—'
	const slides = [
		slide(1, data.domain, 'Персональный разбор', `Где ${domain}<br><em>может недополучать заявки?</em>`, `
			<div class="cover-grid"><div><div class="browser"><i></i><b>${domain}</b><span>Поиск · ${region}</span></div>
			<p>${rankNote} Посмотрим, какие направления важны вашему бизнесу и где есть смысл искать рост.</p>
			<div class="cover-tags"><span>${ranked.length} проверенных запросов</span><span>${ranked.length - top10} за пределами топ-10</span><span>потери заявок пока не рассчитаны</span></div></div>
			<div class="cover-graphic">${star}<strong>${ranked.length - top10}</strong><small>запросов за<br>первой страницей</small></div></div>`,
			'Сегодня: сопоставим поисковые данные с вашими задачами и выберем следующий шаг.', true),
		slide(2, data.domain, 'Цель разговора', 'Какие обращения<br><em>ценны для бизнеса?</em>', `
			<div class="choice-grid"><div class="choice"><div class="shape">✳</div><h2>Нужные услуги и города</h2><p>Какие обращения дают вам подходящих клиентов? Где вы действительно работаете?</p><p><b>Уточним:</b> что продвигать в первую очередь.</p></div>
			<div class="choice"><div class="shape square">▣</div><h2>Качество заявки</h2><p>Звонок, форма или встреча — что ведёт к продаже? Какие обращения не подходят?</p><p><b>Уточним:</b> как измерять пользу для бизнеса.</p></div></div>
			<div class="question">Какое направление сейчас для вас приоритетно?</div>`,
			'Согласуем задачу прежде, чем считать позиции и обещать результат.'),
		slide(3, data.domain, 'Текущая картина', 'Сайт уже виден,<br><em>но не по всем запросам</em>', `
			<div class="metric-row"><div class="metric blue"><strong>${top10}</strong><span>из ${ranked.length}<br>в топ-10</span></div><div class="metric lilac"><strong>${eleven20}</strong><span>на местах<br>11–20</span></div><div class="metric yellow"><strong>${twentyPlus}</strong><span>на местах<br>21+</span></div></div>
			<div class="bracket"><div class="brace"></div><p>${ranked.length ? `Это позиции только ${ranked.length} сохранённых фраз. Сначала проверим, какие из них приводят нужных клиентов.` : 'Пока нечего сравнивать: сначала согласуем запросы, регион и снимем исходные позиции.'}</p></div>`,
			'Позиция по выбранной фразе не равна доле всего трафика сайта.'),
		slide(4, data.domain, 'Ближайший смысл для бизнеса', beyond.length ? 'Какие запросы<br><em>проверить первыми?</em>' : 'Какие запросы<br><em>уже дают видимость?</em>', `
			<div class="hot-grid">${cards}</div>
			<div class="business-point"><div>${star}</div><p>Позиция сама по себе не показывает ценность. Спросим, ищут ли по этим фразам ваших будущих клиентов, и проверим соответствующие страницы.</p></div>`,
			'Вопрос владельцу: эти запросы для вас важны или приоритет следует поменять?'),
		slide(5, data.domain, 'Кто выше', 'По одному запросу клиент<br><em>видит другие сайты</em>', `
			<div class="rivals-grid"><div class="serp"><div class="serp-label">${focusName}</div>
			${rivals.length ? rivals.map(competitorRow).join('') : '<div class="empty">В сохранённом замере нет сопоставимых доменов выше. Проверим выдачу во время теста.</div>'}
			${focus ? `<div class="serp-row mine"><b>${pos(focus.position)}</b><span>${domain}</span><small>ваш сайт</small></div>` : ''}</div>
			<div class="rivals-side"><div>${star}</div><h2>Сравниваем релевантных игроков</h2><p>Площадка и прямой конкурент — не одно и то же. На встрече уточним, с кем вы действительно боретесь за клиента.</p></div></div>`,
			'Вопрос владельцу: кого из этих сайтов вы считаете реальным конкурентом?'),
		slide(6, data.domain, 'Карта запросов', 'Проверенные фразы<br><em>в одном экране</em>', `
			<div class="query-head"><span>Запрос</span><b>Место</b><small>Как читать</small></div><div class="query-list">${table}</div>`,
			`Показаны ${Math.min(10, ranked.length)} из ${ranked.length} фраз · ${measured}. Не каждую фразу нужно продвигать.`),
		slide(7, data.domain, 'Потенциальные обращения', 'Сколько заявок<br><em>сайт недополучает?</em>', `
			<div class="equation"><div><b>Показы</b><span>Вебмастер: видимость нужных страниц</span></div><i>×</i><div><b>Прирост CTR</b><span>сколько дополнительных кликов реально возможно</span></div><i>×</i><div><b>Конверсия</b><span>Метрика и CRM: доля качественных обращений</span></div></div>
			<div class="range"><strong>?</strong><b>дополнительных заявок</b><p>Число пока неизвестно. Без показов, кликов и конверсии точный «недобор» был бы выдумкой.</p></div>`,
			'На тесте посчитаем сценарный диапазон, а не гарантированный результат.'),
		slide(8, data.domain, 'Пятидневная диагностика', 'Что проверим<br><em>за 5 дней?</em>', `
			<div class="days-grid"><div><b>Старт</b><p>Согласуем 2–3 услуги, запросы и регион. Зафиксируем позиции.</p></div><div><b>Проверка</b><p>Сопоставим спрос, выдачу, посадочные страницы и аналитику.</p></div><div><b>Результат</b><p>Покажем находки, приоритет работ и возможный объём заявок при доступных данных.</p></div></div>
			<div class="test-compare"><div><span>Сейчас</span><b>${compare}</b><small>места выбранных запросов</small></div><i>→</i><div><span>После пяти дней</span><b>?</b><small>повторный замер</small></div></div>`,
			'Цель теста — принять решение на фактах. Рост позиций за пять дней не обещаем.'),
		slide(9, data.domain, 'Следующий шаг', 'Выберем одно направление<br><em>и проверим его</em>', `
			<div class="final-grid"><div class="final-card"><div class="shape">✳</div><h2>От вас</h2><p>Приоритетная услуга и город.</p><p>Что считать хорошей заявкой.</p><p>Доступ к Метрике и Вебмастеру только на чтение.</p></div>
			<div class="final-card accent"><div class="shape square">▣</div><h2>От SkySEO</h2><p>Проверка спроса, страниц и конкурентов.</p><p>Оценка возможных обращений по вашим данным.</p><p>Через пять дней — выводы и следующий шаг.</p></div></div>
			<div class="question">Какую услугу и город возьмём для первой проверки?</div>`,
			'После согласия фиксируем направление, ответственного и дату обсуждения результата.', true),
	]
	return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>SkySEO · ${domain}</title><style>${CSS}</style></head><body>${slides.join('')}</body></html>`
}

const CSS = `
@font-face{font-family:Helio;src:url(data:font/ttf;base64,${FONT_REGULAR_B64})}
@font-face{font-family:Helio;src:url(data:font/ttf;base64,${FONT_BOLD_B64});font-weight:700}
@page{size:297mm 167mm;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0;font-family:Helio,Arial,sans-serif;color:#1b1b21;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.slide{position:relative;width:297mm;height:167mm;overflow:hidden;padding:10mm 16mm 12mm;background:#fff;page-break-after:always}.slide:last-child{page-break-after:auto}.slide.dark{background:#1400ff;color:#fff}
header{height:10mm;display:flex;justify-content:space-between;align-items:center;font-size:8pt;color:#6d6d79}.dark header{color:#d9d9ff}.brand{display:flex;align-items:center;gap:2mm;color:#1b1b21;font-size:12pt}.brand img{width:7mm;height:7mm}.dark .brand{color:#fff}.dark .brand img{filter:brightness(0) invert(1)}
.heading{margin-top:5mm;height:37mm}.eyebrow{display:inline-block;background:#e5e5e9;color:#303038;border-radius:20mm;padding:1.4mm 3mm;font-size:8.5pt;font-weight:700}.dark .eyebrow{background:#e5e5e9;color:#303038}h1{font-size:28pt;line-height:1.06;letter-spacing:-.035em;margin:2mm 0 0}h1 em{color:#1400ff;font-style:normal}.dark h1 em{color:#ffe381}
.body{height:92mm;position:relative}.takeaway{position:absolute;bottom:13mm;left:16mm;right:16mm;padding:3mm 4mm;border-radius:3mm;background:#ffe381;color:#23212e;font-size:9pt;font-weight:700;line-height:1.25;min-height:11mm}.dark .takeaway{background:#fff;color:#1400ff}footer{position:absolute;bottom:5mm;left:16mm;right:16mm;display:flex;justify-content:space-between;font-size:7pt;color:#797988}.dark footer{color:#d7d4ff}
.cover-grid{display:grid;grid-template-columns:1.5fr .7fr;gap:10mm;height:72mm}.cover-grid p{font-size:14pt;line-height:1.32;max-width:155mm;margin:7mm 0}.browser{display:flex;align-items:center;gap:3mm;background:#fff;color:#272436;border-radius:3mm;padding:3mm 4mm;font-size:10pt;max-width:160mm}.browser i{display:block;width:2.2mm;height:2.2mm;border-radius:50%;background:#1400ff;box-shadow:4mm 0 #c7cdff,8mm 0 #ffe381;margin-right:9mm}.browser b{max-width:90mm;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.browser span{margin-left:auto;color:#6d6d79;font-size:8pt}.cover-tags{display:flex;gap:2mm;flex-wrap:wrap}.cover-tags span{background:#e5e5e9;color:#303038;padding:2mm 3mm;border-radius:10mm;font-size:8pt}.cover-graphic{position:relative;background:#fff;border-radius:5mm;color:#1400ff;display:flex;flex-direction:column;align-items:center;justify-content:center}.cover-graphic svg{width:25mm;height:25mm;position:absolute;top:4mm;right:6mm}.cover-graphic strong{font-size:45pt;line-height:1}.cover-graphic small{text-align:center;font-size:9pt;line-height:1.3}
.choice-grid,.final-grid{display:grid;grid-template-columns:1fr 1fr;gap:5mm;height:58mm}.choice,.final-card{border-radius:4mm;background:#f3f3f8;padding:5mm 6mm}.choice h2,.final-card h2{font-size:17pt;margin:2mm 0}.choice p,.final-card p{font-size:10.5pt;line-height:1.3;margin:0 0 3mm;max-width:110mm}.shape{font-size:19pt;line-height:1;color:#1400ff}.shape.square{color:#d3a900}.question{margin-top:5mm;padding:5mm 6mm;background:#c7cdff;color:#1b1b21;border-radius:3mm;font-size:13pt;font-weight:700}
.metric-row{display:grid;grid-template-columns:repeat(3,1fr);gap:5mm;height:52mm}.metric{border-radius:4mm;display:flex;align-items:center;gap:5mm;padding:5mm 7mm}.metric strong{font-size:50pt;line-height:1}.metric span{font-size:11pt;line-height:1.3}.metric.blue{background:#1400ff;color:#fff}.metric.lilac{background:#c7cdff}.metric.yellow{background:#ffe381}.bracket{display:flex;align-items:center;gap:5mm;margin-top:5mm;background:#f4f4f9;padding:3mm 4mm;border-radius:0 3mm 3mm 0}.brace{height:15mm;width:3mm;border-left:1mm solid #1400ff;border-top:1mm solid #1400ff;border-bottom:1mm solid #1400ff;flex:none}.bracket p{font-size:10.5pt;line-height:1.3;margin:0}
.hot-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:4mm;height:57mm}.hot{background:#f3f3f8;border-radius:4mm;padding:5mm;display:flex;flex-direction:column}.hot span{font-size:10.5pt;line-height:1.3;min-height:19mm;font-weight:700;overflow:hidden}.hot strong{font-size:35pt;line-height:1;color:#1400ff}.hot small{font-size:8pt;color:#6d6d79}.business-point{display:flex;align-items:center;gap:6mm;background:#ffe381;border-radius:3mm;padding:3mm 6mm;margin-top:5mm;min-height:24mm}.business-point svg{width:13mm;height:13mm}.business-point p{font-size:10pt;line-height:1.3;margin:0}
.rivals-grid{display:grid;grid-template-columns:1.45fr .85fr;gap:6mm}.serp-label{font-size:10pt;color:#1400ff;font-weight:700;margin-bottom:2mm}.serp-row{display:grid;grid-template-columns:9mm 1fr 30mm;gap:3mm;align-items:center;background:#f3f3f8;border-radius:2mm;margin:1.5mm 0;padding:1.4mm 3mm;font-size:9pt;min-height:7mm}.serp-row b{color:#1400ff}.serp-row span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.serp-row small{color:#6d6d79;text-align:right}.serp-row.mine{background:#c7cdff;font-weight:700}.rivals-side{background:#ffe381;border-radius:4mm;padding:5mm;display:flex;flex-direction:column;justify-content:center}.rivals-side svg{width:14mm;height:14mm}.rivals-side h2{font-size:15pt;line-height:1.2;margin:2mm 0}.rivals-side p{font-size:9.5pt;line-height:1.35;margin:0}.empty{font-size:10pt;line-height:1.4;padding:5mm;background:#f3f3f8;border-radius:3mm}
.query-head,.query-row{display:grid;grid-template-columns:1fr 18mm 43mm;gap:3mm;align-items:center;padding:1mm 4mm}.query-head{background:#1400ff;color:#fff;border-radius:2mm;font-size:8pt;font-weight:700}.query-row{border-bottom:1px solid #e4e4ec;font-size:8.4pt;min-height:5.9mm}.query-row span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.query-row b{font-size:11pt;color:#1400ff}.query-row small{font-size:7.7pt;color:#6d6d79}.query-list{margin-top:1mm}
.equation{display:grid;grid-template-columns:1fr 8mm 1fr 8mm 1fr;gap:3mm;align-items:stretch;height:46mm}.equation>div{background:#f3f3f8;border-radius:3mm;padding:5mm;display:flex;flex-direction:column;justify-content:center}.equation b{font-size:15pt;color:#1400ff}.equation span{font-size:9pt;line-height:1.3;margin-top:2mm}.equation i{font-size:24pt;color:#1400ff;font-style:normal;align-self:center;text-align:center}.range{background:#ffe381;margin-top:5mm;padding:5mm 7mm;border-radius:4mm;display:flex;align-items:center;gap:7mm;min-height:29mm}.range strong{font-size:28pt;color:#1400ff}.range b{font-size:10pt;white-space:nowrap}.range p{font-size:10pt;line-height:1.35;margin:0}
.days-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:4mm;height:43mm}.days-grid div{background:#f3f3f8;border-radius:3mm;padding:4mm 5mm}.days-grid b{font-size:14pt;color:#1400ff}.days-grid p{font-size:9.5pt;line-height:1.3;margin:2mm 0 0}.test-compare{display:grid;grid-template-columns:1fr 12mm 1fr;gap:3mm;align-items:center;margin-top:5mm;height:31mm}.test-compare>div{height:100%;background:#c7cdff;border-radius:3mm;padding:3mm 5mm;display:flex;align-items:center;gap:5mm}.test-compare>div:last-child{background:#ffe381}.test-compare span{font-size:9pt}.test-compare b{font-size:23pt;color:#1400ff;white-space:nowrap}.test-compare small{font-size:8pt;margin-left:auto;max-width:38mm}.test-compare i{font-size:23pt;color:#1400ff;text-align:center;font-style:normal}.final-card{background:#fff;color:#1b1b21}.final-card.accent{background:#ffe381}.dark .question{background:#fff;color:#1400ff}
`
