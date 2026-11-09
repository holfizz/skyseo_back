import { LOGO_SVG_B64 } from './report.assets'
import { ReportData } from './report.types'
import { CALL_PRESENTATION_CSS } from './call-presentation.styles'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Research, DeckSlide } from '../crm/preparation/types'
import { tokens } from '../crm/preparation/research'

const style: string = require(join(process.cwd(), 'scripts/lib/client-presentation-style.cjs'))
const trial = require(join(process.cwd(), 'scripts/lib/client-trial-case.cjs'))
const directory = join(process.cwd(), 'src/report/illustrations')
const portfolio = JSON.parse(readFileSync(join(directory, 'portfolio/index.json'), 'utf8')) as {
 publishedCount: number; items: Array<{ id: string; label: string }>
}
const featured = JSON.parse(readFileSync(join(directory, 'case-cards/index.json'), 'utf8')).cases as Array<{
 id: string; title: string; color: string; metric: string; metricLabel: string; category: string;
 niche: string; region: string; domain: string; logo: string; image: string; href: string
}>
const esc = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
 .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
const asset = (file: string, mime = 'image/png') => `data:${mime};base64,${readFileSync(join(directory, file)).toString('base64')}`
const date = (value?: string) => value && Number.isFinite(Date.parse(value))
 ? new Date(value).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' }) : ''
const rank = (position: number | null, scanned: number) => position ?? (scanned ? `>${scanned}` : 'Нет замера')
const num = (value: number) => value.toLocaleString('ru-RU', { maximumFractionDigits: 1 })
function url(value: string) {
 try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) ? esc(u.href) : '#' } catch { return '#' }
}
export function measuredKeywords(research: Research) {
 return research.keywords.filter(k => date(k.measuredAt) && !k.error && k.scanned > 0)
}
export function scenarioRows(research: Research) {
 const groups = new Set<string>()
 return research.keywords.filter(k => Number.isFinite(k.volume) && k.volume! >= 0 && date(k.volumeAt) && k.volumeRegion === research.region.lr)
  .sort((a, b) => b.volume! - a.volume!).filter(k => {
   if (groups.has(k.group)) return false
   groups.add(k.group); return true
  }).slice(0, 4)
}
export function buildSlideOutline(research: Research): DeckSlide[] {
 const slides: DeckSlide[] = [
  { id: 'cover', kind: 'COVER', title: `Клиенты из поиска для ${research.companyName || research.domain}` },
  { id: 'focus', kind: 'FOCUS', title: 'Какие направления важнее для бизнеса' },
 ]
 if (measuredKeywords(research).length) slides.push({ id: 'positions', kind: 'POSITIONS', title: 'Как сайт выглядит в поиске' })
 for (const comp of research.comparisons.filter(c => c.image && c.apply).slice(0, 2)) {
  slides.push({ id: comp.id, kind: 'COMPARISON', comparisonId: comp.id, title: comp.feature })
 }
 if (scenarioRows(research).length) slides.push({ id: 'potential', kind: 'POTENTIAL', title: 'Как поисковый спрос превращается в заявки' })
 slides.push(
  { id: 'case', kind: 'CASE', title: 'Что изменилось за 5 дней теста' },
  { id: 'advantages', kind: 'ADVANTAGES', title: 'Одна команда вместо нескольких подрядчиков' },
  { id: 'portfolio', kind: 'PORTFOLIO', title: `${Math.floor(portfolio.publishedCount / 10) * 10}+ примеров работ` },
  { id: 'next', kind: 'NEXT', title: research.trial === 'CONFIRMED'
   ? 'Сначала покажем, что умеем. Потом обсудим сотрудничество.' : 'С чего начнем на вашем сайте' },
 )
 for (let i = 0; i < research.keywords.length; i += 20) {
  slides.push({ id: `keywords-${i}`, kind: 'KEYWORDS', title: 'Запросы по ассортименту сайта', keywordOffset: i })
 }
 return slides
}
function measurementSource(research: Research) {
 const dates = [...new Set(measuredKeywords(research).map(k => date(k.measuredAt)))]
 return dates.length ? `Яндекс, ${research.region.name}. Замеры ${dates.join(', ')}.` : `Регион: ${research.region.name}.`
}
function coverVisual() {
 return `<div class="cover-visual"><img src="${asset('editorial-focus-v1.png')}" alt="Художественная иллюстрация оптики в серо-синей гамме"></div>`
}
function comparisonPanel(research: Research, kind: 'client' | 'competitor', c: Research['comparisons'][number]) {
 const mine = kind === 'client', image = mine ? c.clientImage : c.image
 return `<div class="comparison-panel ${mine ? 'mine' : ''}"><div class="comparison-label"><span>${mine ? 'Ваш сайт' : 'Выше в выдаче'}</span>
  <b>${rank(mine ? c.clientPosition : c.competitor.position, c.scanned)}</b></div>
  <div class="comparison-shot">${image ? `<img src="${esc(image)}" alt="Страница ${esc(mine ? research.domain : c.competitor.domain)}">` : '<span>Снимок страницы не сохранен</span>'}</div>
  <div class="comparison-summary"><a href="${url(mine ? c.clientUrl : c.competitor.url)}">${esc(mine ? research.domain : c.competitor.domain)}</a>
  <p>${esc(mine ? c.clientFinding : c.competitorFinding)}</p></div></div>`
}
function slideContent(research: Research, slide: DeckSlide): { body: string; question?: string; source?: string } {
 const measured = measuredKeywords(research)
 switch (slide.kind) {
  case 'COVER': return {
   body: `<div class="proposal-cover"><div class="cover-message"><span class="soft-label">SEO и продвижение в нейросетях</span>
    <p>Покажем, где сайт сейчас.<br>Обсудим, куда двигаться дальше.</p><div class="domain-sticker">${esc(research.domain)}</div>
    <small>${esc(research.region.name)}${research.region.assumed ? ' (регион требует уточнения)' : ''}</small></div>${coverVisual()}</div>`,
   source: measurementSource(research), question: 'Что вы хотели бы изменить в привлечении клиентов с сайта?',
  }
  case 'FOCUS': {
   const topics = [...new Set(research.keywords.map(k => k.group || k.keyword))].slice(0, 3)
   return { body: `<div class="focus-layout"><div class="focus-topics"><span class="soft-label">Направления из разбора ${esc(research.domain)}</span>
    ${topics.length ? topics.map(t => `<div class="topic-card">${esc(t)}</div>`).join('') : '<div class="topic-card">Выберем товары и услуги на встрече</div>'}</div>
    <div class="focus-choice"><span>Что важнее сейчас?</span><strong>Больше заявок<br>Нужные товары<br>Новые регионы</strong><p>Начнем с вашего приоритета</p></div></div>`,
    question: 'Какое направление вы хотите развивать в первую очередь?',
   }
  }
  case 'POSITIONS': {
   const ranked = measured.filter(k => k.position !== null).sort((a, b) => a.position! - b.position!)
   const top = ranked.filter(k => k.position! <= 10).length
   const rows = [...ranked.slice(0, 3), ...measured.filter(k => k.position === null)].slice(0, 4)
   return { body: `<div class="positions-layout"><div class="position-map"><div class="count-pair"><div><strong>${top}</strong><span>в топ-10</span></div>
    <div><strong>${measured.length - top}</strong><span>за топ-10</span></div></div>
    <p>${measured.length} замеров из ${research.keywords.length} выбранных фраз</p></div>
    <div class="position-examples">${rows.map(k => `<div class="position-row"><span>${esc(k.keyword)}</span><b>${rank(k.position, k.scanned)}</b></div>`).join('')}
    <small>Число справа = место сайта. Знак &gt; означает отсутствие в проверенной глубине.</small></div></div>`,
    source: measurementSource(research), question: 'По каким из этих запросов вам особенно нужны обращения?',
   }
  }
  case 'COMPARISON': {
   const c = research.comparisons.find(c => c.id === slide.comparisonId)!
   return { body: `<div class="comparison-query">${esc(c.keyword)}</div><div class="comparison-panels">${comparisonPanel(research, 'client', c)}${comparisonPanel(research, 'competitor', c)}</div>
    <div class="apply-strip"><span>Что применим</span><strong>${esc(c.apply)}</strong><small>${esc(c.benefit)}</small></div>`,
    source: `${measurementSource(research)} Страницы проверены ${date(c.capturedAt)}.`, question: 'Какие из этих характеристик важны вашим покупателям?',
   }
  }
  case 'POTENTIAL': {
   const rows = scenarioRows(research)
   return { body: `<div class="scenario-label">Условный сценарий. Уточним по вашей аналитике</div><div class="conversion-flow"><div><b>6%</b><span>в переходы</span></div><i>→</i><div><b>3%</b><span>в заявки</span></div><i>→</i><div><b>20%</b><span>в сделки</span></div></div>
    <div class="demand-grid">${rows.slice(0, 3).map(k => `<div class="demand-card"><span>${esc(k.keyword)}</span><strong>${num(k.volume!)}</strong><small>показов Wordstat</small><div><b>${num(k.volume! * .06 * .03)}</b><span>заявки в примере</span></div></div>`).join('')}</div>
    <p class="quiet-note">Спрос × 6% × 3% = пример заявок. Проценты условные. Частоты не складываем.</p>`,
    source: `Wordstat, ${research.region.name}. Даты ${[...new Set(rows.map(k => date(k.volumeAt)))].join(', ')}. Широкое соответствие.`,
    question: 'Сколько заявок из поиска вы получаете сейчас?',
   }
  }
  case 'CASE': return {
   body: `<div class="before-after">${trial.screenshots.map((shot: any) => `<div class="evidence-sheet"><div><strong>${shot.phase === 'before' ? 'До теста' : 'После теста'}</strong><span>${shot.displayDate}</span></div>
    <div class="evidence-image"><img src="${shot.image}" alt="Исходный снимок Топвизора ${shot.displayDate}"></div></div>`).join('')}</div>
    <div class="result-strip"><div><span>забор купить</span><b>12 → 3</b></div><div><span>купить забор</span><b>21 → 6</b></div><div class="result-caption">Реальные замеры<br>до обсуждения договора</div></div>`,
   source: 'Кейс другого проекта. Отдельные изменения с 26 по 30 сентября 2026 года. На вашем сайте результат измерим отдельно.',
   question: 'Вам было бы полезно сначала увидеть замеры на своем сайте?',
  }
  case 'ADVANTAGES': return {
   body: `<div class="team-layout"><div class="team-card"><span>Все внутри одной работы</span><strong>SEO<br>Разработка<br>Тексты</strong><p>Не нужно искать и координировать отдельных специалистов</p></div>
    <div class="team-details"><div><span>В составе SEO без доплаты</span><strong>ChatGPT и Алиса</strong><p>Работа над присутствием компании в ответах нейросетей</p></div>
    <div class="experience-card"><strong>2004</strong><p>С этого года в SEO<br>наш специалист</p></div></div></div>`,
   question: 'Что для вас важнее всего при выборе подрядчика?',
  }
  case 'PORTFOLIO': {
   const topics = new Set(tokens(research.keywords.map(k => k.keyword).join(' ')))
   const related = (label: string) => tokens(label).filter(t => topics.has(t)).length
   const examples = [...portfolio.items].sort((a, b) => related(b.label) - related(a.label))
   return { body: `<div class="featured-case-grid">${featured.map(c => `<a class="portfolio-feature" href="${url(c.href)}" style="--case-color:${esc(c.color)}">
    <div class="case-brand"><img src="${asset(`case-cards/${c.logo}`, c.logo.endsWith('.svg') ? 'image/svg+xml' : 'image/png')}" alt="${esc(c.title)}"><span>${esc(c.category)}</span></div>
    <h2>${esc(c.title)}</h2><p>${esc(c.niche)}</p><strong>${esc(c.metric)}</strong><span class="case-metric-label">${esc(c.metricLabel)}</span>
    <small>${esc(c.region)}</small></a>`).join('')}</div><div class="portfolio-ribbon">${examples.slice(0, 8).map(item => `<a href="https://skyseo.site/cases/serp/${item.id}.jpg"><img src="${asset(`portfolio/${item.id}.jpg`, 'image/jpeg')}" alt="${esc(item.label)}"><span>${esc(item.label)}</span></a>`).join('')}</div>`,
    source: 'Примеры опубликованных работ. Карточки ведут к кейсам, миниатюры открывают полные снимки выдачи.',
    question: 'Какие примеры ближе к вашему бизнесу?',
   }
  }
  case 'NEXT': {
   const confirmed = research.trial === 'CONFIRMED'
   const offer = confirmed ? '5 дней бесплатно на вашем сайте' : research.trial === 'UNAVAILABLE' ? 'План под задачи вашего сайта' : 'Начнем с оценки сайта для бесплатного теста'
   const steps = confirmed ? ['Выбираем запросы', 'Проводим тест', 'Сравниваем позиции'] : ['Выбираем направление', 'Специалист оценивает сайт', 'Согласуем следующий шаг']
   return { body: `<div class="next-layout"><div><div class="next-offer">${offer}</div><div class="next-domain">${esc(research.domain)}</div><div class="next-steps">${steps.map(t => `<div>${t}</div>`).join('')}</div></div>
    <img class="next-art" src="${asset('editorial-focus-v1.png')}" alt="Художественная иллюстрация оптики"></div>`,
    question: confirmed ? 'Запускаем тест по согласованному направлению?' : 'Передаем сайт специалисту и выбираем подходящий формат?',
   }
  }
  case 'KEYWORDS': return {
   body: `<div class="keyword-grid">${research.keywords.slice(slide.keywordOffset, slide.keywordOffset! + 20).map((k, i) => `<div class="keyword-row"><b>${slide.keywordOffset! + i + 1}</b><span>${esc(k.keyword)}${measured.includes(k) ? `<small>Место ${rank(k.position, k.scanned)}, ${date(k.measuredAt)}</small>` : ''}</span></div>`).join('')}</div>`,
   source: `${research.keywords.length} выбранных фраз по страницам сайта. ${measured.length} с замерами. ${research.region.name}. Фраза без числа = позиция не измерена.`,
  }
 }
}
export function renderResearchPresentation(research: Research, outline = buildSlideOutline(research), onlySlide?: number) {
 const slides = onlySlide === undefined ? outline : outline.filter((_, i) => i === onlySlide)
 const html = slides.map(s => {
  const content = slideContent(research, s), index = outline.indexOf(s)
  return `<section class="slide kind-${s.kind.toLowerCase()}" data-slide-id="${esc(s.id)}" data-slide-number="${index + 1}">
   <header><div class="brand"><img src="data:image/svg+xml;base64,${LOGO_SVG_B64}" alt=""><b>SkySEO</b></div><span>${esc(research.domain)}</span></header>
   <div class="slide-title"><h1>${esc(s.title)}</h1></div><div class="slide-body">${content.body}</div>
   <div class="slide-bottom">${content.source ? `<small class="measurement-source">${esc(content.source)}</small>` : ''}${content.question ? `<div class="call-question">${esc(content.question)}</div>` : ''}</div></section>`
 }).join('')
 return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(research.companyName)}: SEO</title><style>${CALL_PRESENTATION_CSS}${style}</style></head><body class="proposal">${html}</body></html>`
}
/** Compatibility entry: no invented measurement time, region, landing URL or depth. */
export function renderCallPresentationHtml(data: ReportData) {
 const research: Research = {
  version: 1, domain: data.domain, companyName: data.companyName || data.domain,
  region: { name: data.region || 'Регион требует уточнения', lr: 0, assumed: !data.region }, sitePages: [],
  keywords: data.keywords.map(k => ({ ...k, clientEvidenceUrl: '', group: k.keyword, url: null,
   scanned: k.position || 0, top10: k.competitors, measuredAt: data.measuredAt?.toISOString(),
   volumeAt: undefined, volumeRegion: undefined })),
  comparisons: [], issues: [], completed: [], trial: 'UNCONFIRMED', createdAt: data.generatedAt.toISOString(),
 }
 return renderResearchPresentation(research)
}
