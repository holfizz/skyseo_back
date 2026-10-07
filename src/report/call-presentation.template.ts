import { LOGO_SVG_B64 } from './report.assets'
import { ReportData, ReportKeyword } from './report.types'
import { CALL_PRESENTATION_CSS } from './call-presentation.styles'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Девять стабильных слайдов для разговора с владельцем. Их номера совпадают
// с подсказками в панели «Созвон»; публичный старый отчёт остаётся отдельным.
const esc = (value: unknown): string => String(value ?? '')
	.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
const date = (value: Date | null): string => value
	? value.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Moscow' })
	: 'дата замера не сохранена'
const pos = (value: number | null): string => value !== null && value > 0 ? String(value) : '—'
const star = '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 1l5.4 17.6L47 24l-17.6 5.4L24 47l-5.4-17.6L1 24l17.6-5.4Z" fill="#b8bac3"/></svg>'
const coverArt = readFileSync(join(process.cwd(), 'src/report/illustrations/cover-search-steps.svg')).toString('base64')
const marketplace = /(^|\.)(avito\.ru|profi\.ru|2gis\.ru|yell\.ru|flamp\.ru|zoon\.ru|otzovik\.com|uslugi\.yandex\.ru)$/i
// Это только порядок примеров для обсуждения, не оценка ценности запроса.
const intentScore = (keyword: string): number =>
	/(заказать|вызвать|купить|приобрести|нанять|записаться|оформить)/i.test(keyword) ? 2
		: /(цена|стоимость|аренда|доставка|услуги)/i.test(keyword) ? 1 : 0

function slide(n: number, domain: string, eyebrow: string, title: string, body: string, takeaway: string, dark = false): string {
	return `<section class="slide${n === 1 ? ' cover' : ''}${dark ? ' dark' : ''}"><header><div class="brand"><img src="data:image/svg+xml;base64,${LOGO_SVG_B64}" alt=""/><b>SkySEO</b></div><span>Разбор сайта · ${esc(domain)}</span></header>
		<div class="heading">${eyebrow ? `<span class="eyebrow">${esc(eyebrow)}</span>` : ''}<h1>${title}</h1></div>
		<div class="body">${body}</div>${takeaway ? `<div class="takeaway">${takeaway}</div>` : ''}
		<footer><span>Сохранённый срез поиска · выводы требуют проверки с бизнесом</span><span>${n} / 9</span></footer></section>`
}

function rankPlot(k: ReportKeyword | undefined, maxPosition: number): string {
	if (!k || !k.position) return '<div class="rank-empty">Запросы для сравнения выберем вместе</div>'
	const left = Math.min(96, Math.max(3, (k.position - 1) / (maxPosition - 1) * 100))
	return `<div class="rank-line"><span>«${esc(k.keyword)}»</span><div class="rank-track"><i class="rank-first" style="width:${9 / (maxPosition - 1) * 100}%"></i><i class="rank-dot" style="left:${left}%"></i></div><b>${k.position}</b></div>`
}

function queryGroup(items: ReportKeyword[], limit: number): string {
	return items.slice(0, limit).map(k => `<div class="query-chip"><span>${esc(k.keyword)}</span><b>${pos(k.position)}</b></div>`).join('')
		+ (items.length > limit ? `<div class="query-overflow">+ ещё ${items.length - limit}</div>` : '')
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
		.sort((a, b) => a.position - b.position)
	const siteRivals = rivals.filter(c => !marketplace.test(c.domain)).slice(0, 3)
	const shownRivals = siteRivals.length ? siteRivals : rivals.slice(0, 3)
	const region = data.region ? esc(data.region) : 'регион не указан'
	const measured = `${region} · замер ${date(data.measuredAt)}`
	const domain = esc(data.domain)
	const pageOne = ranked.filter(k => (k.position ?? 99) <= 10)
	const outside = ranked.filter(k => (k.position ?? 0) > 10)
	const established = pageOne[0] ?? ranked[0]
	const opportunity = beyond.length ? priorities[0] : ranked.find(k => k !== established)
	const maxPlotPosition = Math.max(30, ...priorities.map(k => k.position ?? 0))
	const cards = Array.from({ length: 3 }, (_, index) => rankPlot(priorities[index], maxPlotPosition)).join('')
	const focusName = focus ? `«${esc(focus.keyword)}»` : 'Запрос ещё не выбран'
	const scale = Math.max(1, top10, eleven20, twentyPlus)
	const positionRow = (label: string, count: number, tone: string) => `<div class="position-row"><b>${label}</b><div class="position-track"><i class="${tone}" style="width:${count / scale * 100}%"></i></div><strong>${count}</strong></div>`
	const coverTitle = data.domain.length <= 24
		? `Где ${domain}<br><em>может недополучать заявки?</em>`
		: 'Где сайт может<br><em>недополучать заявки?</em>'
	const slides = [
		slide(1, data.domain, '', coverTitle, `
			<div class="cover-grid"><div class="cover-main"><div class="cover-domain">Яндекс · ${measured}</div>
			<p>${ranked.length ? `Из ${ranked.length} проверенных запросов ${ranked.length - top10} находятся за первой страницей. Покажу, где именно.` : 'Сначала согласуем запросы и регион, затем снимем исходные позиции.'}</p>
			<div class="cover-tags"><span>${top10} из ${ranked.length} в топ-10</span><span>${ranked.length - top10} за первой страницей</span></div>
			<div class="cover-note">Заявки оценим после проверки аналитики.</div></div>
			<img class="cover-art" src="data:image/svg+xml;base64,${coverArt}" alt="Абстрактная схема поисковой выдачи"/></div>`, ''),
		slide(2, data.domain, 'Цель разговора', 'Какие запросы<br><em>приводят ваших клиентов?</em>', `
			<div class="decision-compare"><div class="decision-card"><span>${pageOne.length ? 'Уже на первой странице' : 'Лучшее сохранённое место'}</span><strong>${pos(established?.position ?? null)}</strong><b>${established ? `«${esc(established.keyword)}»` : 'Пока нет замера'}</b></div>
			<div class="decision-card"><span>${beyond.length ? 'За первой страницей' : 'Ещё один запрос'}</span><strong>${pos(opportunity?.position ?? null)}</strong><b>${opportunity ? `«${esc(opportunity.keyword)}»` : 'Приоритет определим вместе'}</b></div></div>
			<div class="decision-caption">Место в поиске видно. Ценность каждого обращения знаете вы.</div>
			<div class="question">Какую услугу и город стоит проверить первыми?</div>`,
			'Согласуем приоритет: не каждый проверенный запрос нужен вашему бизнесу.'),
		slide(3, data.domain, 'Текущая картина', ranked.length ? 'Сайт уже виден,<br><em>но не по всем запросам</em>' : 'Начнём с замера<br><em>нужных запросов</em>', `
			<div class="position-map"><div class="position-caption"><span>Распределение проверенных фраз по зонам выдачи</span><b>${ranked.length} запросов</b></div>
			${positionRow('Первая страница', top10, 'first')}${positionRow('Места 11–20', eleven20, 'middle')}${positionRow('Места 21+', twentyPlus, 'deep')}</div>
			<div class="bracket"><div class="brace"></div><p>${ranked.length ? `Это позиции только ${ranked.length} сохранённых фраз. Сначала проверим, какие из них приводят нужных клиентов.` : 'Пока нечего сравнивать: сначала согласуем запросы, регион и снимем исходные позиции.'}</p></div>`,
			'Позиция по выбранной фразе не равна доле всего трафика сайта.'),
		slide(4, data.domain, 'Ближайший смысл для бизнеса', beyond.length ? 'Где эти запросы<br><em>сейчас в поиске?</em>' : 'Какие запросы<br><em>уже дают видимость?</em>', `
			<div class="rank-plot"><div class="rank-axis"><span>1</span><span>10 · первая страница</span><span>${maxPlotPosition} место</span></div>${cards}</div>
			<div class="business-point"><div>${star}</div><p>Синяя зона — топ-10. Точки показывают сохранённые позиции, а не прогноз роста.</p></div>`,
			'Вопрос владельцу: какие из этих запросов действительно ведут к продаже?'),
		slide(5, data.domain, 'Кто выше', focus ? `Другие сайты — выше.<br><em>Ваш — на ${pos(focus.position)} месте.</em>` : 'С кем сравним<br><em>ваш сайт?</em>', `
			<div class="compare-query">Один и тот же запрос: <b>${focusName}</b></div>
			<div class="versus-grid"><div class="versus-rivals"><span>Сайты выше в выдаче</span>${shownRivals.length ? shownRivals.map(c => `<div class="versus-row"><b>${c.position}</b><strong>${esc(c.domain)}</strong></div>`).join('') : '<div class="empty">Сопоставимых сайтов в замере нет</div>'}</div>
			<div class="versus-mine"><span>Ваш сайт</span><strong>${pos(focus?.position ?? null)}</strong><b>${domain}</b></div></div>
			<div class="compare-foot">Это сравнение мест в выдаче. Страницы и предложения сравним во время теста.</div>`,
			'Вопрос владельцу: какие из этих сайтов вы считаете прямыми конкурентами?'),
		slide(6, data.domain, 'Карта запросов', ranked.length ? 'Видимость уже есть.<br><em>Следующий шаг — выбрать важное.</em>' : 'Сначала определим<br><em>важные запросы.</em>', `
			<div class="query-columns"><div class="query-column"><div class="query-column-head"><strong>Первая страница</strong><b>${pageOne.length}</b></div>${queryGroup(pageOne, 5)}</div>
			<div class="query-column"><div class="query-column-head"><strong>За первой страницей</strong><b>${outside.length}</b></div>${queryGroup(outside, 5)}</div></div>`,
			`${measured}. Показаны сохранённые позиции; приоритет выбираем вместе.`),
		slide(7, data.domain, 'Потенциальные обращения', 'Сколько заявок<br><em>сайт недополучает?</em>', `
			<div class="opportunity-grid"><div class="opportunity-known"><span>Что видно сейчас</span><strong>${ranked.length - top10}</strong><b>запросов за первой страницей</b></div><div class="opportunity-unknown"><span>Чего пока не видно</span><strong>?</strong><b>возможных дополнительных заявок</b></div></div>
			<div class="data-flow"><div><b>Вебмастер</b><span>показы и клики</span></div><i>→</i><div><b>Метрика</b><span>обращения</span></div><i>→</i><div><b>CRM</b><span>качество заявок</span></div></div>`,
			'На тесте оценим диапазон по реальным данным. Без аналитики число было бы выдумкой.'),
		slide(8, data.domain, 'Пятидневная диагностика', 'Что проверим<br><em>за 5 дней?</em>', `
			<div class="days-grid"><div><small>День 1</small><b>Выбор</b><p>Услуга · город · нужные заявки</p></div><div><small>Дни 2–4</small><b>Проверка</b><p>Выдача · страницы · аналитика</p></div><div><small>День 5</small><b>Решение</b><p>Потенциал · приоритет · план</p></div></div>
			<div class="test-compare"><div><span>Сегодня</span><b>Где сайт</b><small>это мы уже видим</small></div><i>→</i><div><span>Через 5 дней</span><b>Что делать</b><small>покажем по фактам</small></div></div>`,
			'За пять дней проверяем гипотезы и принимаем решение; рост позиций не обещаем.'),
		slide(9, data.domain, 'Следующий шаг', 'Выберем одно направление<br><em>и проверим его</em>', `
			<div class="final-grid"><div class="final-card"><div class="shape">✳</div><h2>От вас</h2><p>Приоритетная услуга и город.</p><p>Что считать хорошей заявкой.</p><p>Доступ к Метрике и Вебмастеру только на чтение.</p></div>
			<div class="final-card accent"><div class="shape square">▣</div><h2>От SkySEO</h2><p>Проверка спроса, страниц и конкурентов.</p><p>Оценка возможных обращений по вашим данным.</p><p>Через пять дней — выводы и следующий шаг.</p></div></div>
			<div class="question">Какую услугу и город возьмём для первой проверки?</div>`,
			'После согласия фиксируем направление, ответственного и дату обсуждения результата.', true),
	]
	return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>SkySEO · ${domain}</title><style>${CALL_PRESENTATION_CSS}</style></head><body>${slides.join('')}</body></html>`
}
