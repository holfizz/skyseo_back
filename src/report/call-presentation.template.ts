import { LOGO_SVG_B64 } from './report.assets'
import { ReportCompetitor, ReportData, ReportKeyword } from './report.types'
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
	const scale = Math.max(1, top10, eleven20, twentyPlus)
	const positionRow = (label: string, count: number, tone: string) => `<div class="position-row"><b>${label}</b><div class="position-track"><i class="${tone}" style="width:${count / scale * 100}%"></i></div><strong>${count}</strong></div>`
	const coverTitle = data.domain.length <= 24
		? `Где ${domain}<br><em>может недополучать заявки?</em>`
		: 'Где сайт может<br><em>недополучать заявки?</em>'
	const slides = [
		slide(1, data.domain, '', coverTitle, `
			<div class="cover-grid"><div class="cover-main"><div class="cover-domain">Яндекс · ${measured}</div>
			<p>${rankNote} Посмотрим, какие направления важны вашему бизнесу и где есть смысл искать рост.</p>
			<div class="cover-tags"><span>${top10} из ${ranked.length} в топ-10</span><span>${ranked.length - top10} за первой страницей</span></div>
			<div class="cover-note">Сколько это заявок, узнаем после проверки аналитики.</div></div>
			<img class="cover-art" src="data:image/svg+xml;base64,${coverArt}" alt="Абстрактная схема поисковой выдачи"/></div>`, ''),
		slide(2, data.domain, 'Цель разговора', 'Какие обращения<br><em>ценны для бизнеса?</em>', `
			<div class="choice-grid"><div class="choice"><div class="shape">✳</div><h2>Нужные услуги и города</h2><p>Какие обращения дают вам подходящих клиентов? Где вы действительно работаете?</p><p><b>Уточним:</b> что продвигать в первую очередь.</p></div>
			<div class="choice"><div class="shape square">▣</div><h2>Качество заявки</h2><p>Звонок, форма или встреча — что ведёт к продаже? Какие обращения не подходят?</p><p><b>Уточним:</b> как измерять пользу для бизнеса.</p></div></div>
			<div class="question">Какое направление сейчас для вас приоритетно?</div>`,
			'Согласуем задачу прежде, чем считать позиции и обещать результат.'),
		slide(3, data.domain, 'Текущая картина', 'Сайт уже виден,<br><em>но не по всем запросам</em>', `
			<div class="position-map"><div class="position-caption"><span>Распределение проверенных фраз по зонам выдачи</span><b>${ranked.length} запросов</b></div>
			${positionRow('Первая страница', top10, 'first')}${positionRow('Места 11–20', eleven20, 'middle')}${positionRow('Места 21+', twentyPlus, 'deep')}</div>
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
	return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>SkySEO · ${domain}</title><style>${CALL_PRESENTATION_CSS}</style></head><body>${slides.join('')}</body></html>`
}
