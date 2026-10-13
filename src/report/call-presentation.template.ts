import { LOGO_SVG_B64 } from './report.assets'
import { ReportData } from './report.types'
import { CALL_PRESENTATION_CSS } from './call-presentation.styles'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Research, DeckSlide } from '../crm/preparation/types'
import { tokens } from '../crm/preparation/research'
const style:string=require(join(process.cwd(),'scripts/lib/client-presentation-style.cjs'))
const trial=require(join(process.cwd(),'scripts/lib/client-trial-case.cjs'))
const portfolio=JSON.parse(readFileSync(join(process.cwd(),'src/report/illustrations/portfolio/index.json'),'utf8')) as {publishedCount:number;items:Array<{id:string;label:string}>}
const esc=(value:unknown)=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
const asset=(file:string,mime='image/png')=>`data:${mime};base64,${readFileSync(join(process.cwd(),'src/report/illustrations',file)).toString('base64')}`
const date=(value?:string)=>value?new Date(value).toLocaleDateString('ru-RU',{timeZone:'Europe/Moscow'}):''
const shorten=(text:string,words=8)=>text.split(/\s+/).slice(0,words).join(' ')
const rank=(position:number|null,scanned:number)=>position??(scanned?`>${scanned}`:'')
function url(value:string){try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)?esc(u.href):'#'}catch{return '#'}}
export function buildSlideOutline(research:Research):DeckSlide[]{
 const slides:DeckSlide[]=[{id:'cover',kind:'COVER',title:`SEO для ${research.companyName||research.domain}`}]
 if(research.keywords.some(k=>k.measuredAt&&!k.error&&k.scanned>0))slides.push({id:'positions',kind:'POSITIONS',title:'Где сайт уже виден в Яндексе'})
 for(const comp of research.comparisons.filter(c=>c.image&&c.apply).slice(0,2))slides.push({id:comp.id,kind:'COMPARISON',comparisonId:comp.id,title:comp.feature})
 if(research.keywords.some(k=>k.volume!==null&&k.volumeRegion===research.region.lr&&k.volumeAt))slides.push({id:'potential',kind:'POTENTIAL',title:'Условный сценарий. Уточним по вашей аналитике'})
 slides.push({id:'case',kind:'CASE',title:'Пример теста до оплаты'},{id:'advantages',kind:'ADVANTAGES',title:'SEO под ключ'},{id:'portfolio',kind:'PORTFOLIO',title:`${Math.floor(portfolio.publishedCount/10)*10}+ примеров работ`},{id:'next',kind:'NEXT',title:research.trial==='CONFIRMED'?'Сначала покажем, что умеем. Потом обсудим сотрудничество.':'Выберем следующий шаг для вашего сайта'})
 for(let i=0;i<research.keywords.length;i+=20)slides.push({id:`keywords-${i}`,kind:'KEYWORDS',title:'Запросы по ассортименту сайта',keywordOffset:i})
 return slides
}
export function scenarioRows(research:Research){
 const groups=new Set<string>()
 return research.keywords.filter(k=>k.volume!==null&&k.volumeAt&&k.volumeRegion===research.region.lr).sort((a,b)=>b.volume!-a.volume!).filter(k=>{if(groups.has(k.group))return false;groups.add(k.group);return true}).slice(0,4)
}
function slideHtml(research:Research,slide:DeckSlide,index:number){
 const measured=research.keywords.filter(k=>k.measuredAt&&!k.error),source=`Яндекс, ${research.region.name}. Замеры ${[...new Set(measured.map(k=>date(k.measuredAt)))].join(', ')}`
 let body='',className=''
 if(slide.kind==='COVER'){
  const image=research.sitePages.find(p=>p.image)?.image||asset('cover-search-steps.svg','image/svg+xml'),logo=research.sitePages.find(p=>p.logo)?.logo
  body=`<div class="cover-layout"><div class="cover-copy"><p>Где сайт уже виден и какие страницы можно усилить</p><div class="cover-facts"><span>${esc(research.domain)}</span><span>${esc(research.region.name)}</span>${measured.length?`<span>Замеры ${[...new Set(measured.map(k=>date(k.measuredAt)))].join(", ")}</span>`:''}</div></div><div class="cover-graphic"><img class="cover-photo" src="${image}">${logo?`<div class="client-logo"><img src="${logo}"></div>`:''}</div></div>`;className='cover'
 }
 if(slide.kind==='POSITIONS'){
  const ranked=measured.filter(k=>k.position!==null).sort((a,b)=>a.position!-b.position!)
  const strong=ranked.filter(k=>k.position!<=10).slice(0,2),first=strong.length?strong:ranked.length?ranked.slice(0,2):measured.slice(0,2),growth=[...ranked.filter(k=>!first.includes(k)&&k.position!>10),...measured.filter(k=>!first.includes(k)&&k.position===null)].slice(0,2)
  const group=(title:string,rows:typeof measured)=>`<div class="proof-group"><h2>${title}</h2>${rows.map(k=>`<div class="proof-item"><span>${esc(k.keyword)}</span><strong class="${k.position&&k.position>10?'mid':''}">${rank(k.position,k.scanned)}</strong></div>`).join('')}</div>`
  body=`<div class="proof-grid">${group(strong.length?'Уже в топ-10':'Измеренные позиции',first)}${growth.length?group('Направления для роста',growth):''}</div><p class="source-note">${esc(source)}. Знак &gt; означает отсутствие в проверенной глубине.</p>`
 }
 if(slide.kind==='COMPARISON'){
  const c=research.comparisons.find(c=>c.id===slide.comparisonId)!
  const compSource=`Яндекс, ${research.region.name}. Замер ${date(research.keywords.find(k=>k.keyword===c.keyword)?.measuredAt)}`
  body=`<div class="comp-ranks two"><div class="comp-rank ours"><strong>${rank(c.clientPosition,c.scanned)}</strong><span>${esc(research.domain)}<br>${esc(c.keyword)}</span></div><div class="comp-rank"><strong>${c.competitor.position}</strong><span>${esc(c.competitor.domain)}<br>${esc(c.keyword)}</span></div></div><div class="comp-pair"><div class="comp-visual"><img src="${c.image}"><div class="comp-source"><a href="${url(c.competitor.url)}">${esc(c.competitor.domain)}</a>. Страница проверена ${date(c.capturedAt)}</div></div><div class="comp-findings"><div class="comp-finding"><b>У вас</b><p>${esc(shorten(c.clientFinding))}</p></div><div class="comp-finding"><b>У конкурента</b><p>${esc(shorten(c.competitorFinding))}</p></div><div class="comp-finding apply"><b>Применим</b><p>${esc(shorten(c.apply))}</p><p class="seo-benefit">${esc(c.benefit)}</p></div></div></div><p class="comp-note">${esc(compSource)}.</p>`
 }
 if(slide.kind==='POTENTIAL'){
  const rows=scenarioRows(research)
  const n=(value:number)=>value.toLocaleString('ru-RU',{maximumFractionDigits:1})
  body=`<div class="scenario-rates"><div class="scenario-rate"><strong>6%</strong><span>Спрос в переходы</span></div><div class="scenario-rate"><strong>3%</strong><span>Переходы в заявки</span></div><div class="scenario-rate"><strong>20%</strong><span>Заявки в сделки</span></div></div><table class="scenario-table"><thead><tr><th>Запрос</th><th>Частота</th><th>Переходы</th><th>Заявки</th><th>Сделки</th></tr></thead><tbody>${rows.map(k=>`<tr><td><b>${esc(k.keyword)}</b></td><td>${n(k.volume!)}</td><td>${n(k.volume!*.06)}</td><td>${n(k.volume!*.06*.03)}</td><td>${n(k.volume!*.06*.03*.2)}</td></tr>`).join('')}</tbody></table><div class="scenario-example"><strong>Спрос × 6% × 3% = пример заявок</strong><span>Проценты условные</span></div><div class="scenario-notes"><p>Это не прогноз и не подтвержденные потери. Частоты не складываем.</p><p>Wordstat, ${esc(research.region.name)}, ${date(rows[0]?.volumeAt)}. Широкое соответствие.</p></div>`;className='opportunity'
 }
 if(slide.kind==='CASE'){
  body=`<div class="trial-pair">${trial.screenshots.map((shot:any)=>`<div class="trial-shot"><h2>${shot.phase==='before'?'До теста':'После теста'}<small>${shot.displayDate}</small></h2><div class="trial-slot"><img src="${shot.image}"></div></div>`).join('')}</div><div class="trial-benefits"><b>забор купить <strong>12 → 3</strong></b><b>купить забор <strong>21 → 6</strong></b><b>5 дней теста</b></div><p class="source-note">Пример другого проекта. Показаны отдельные изменения, результат вашего сайта измерим отдельно.</p>`
 }
 if(slide.kind==='ADVANTAGES')body='<div class="adv-grid"><div class="adv-card"><h2>Под ключ</h2><h3>SEO, правки и тексты</h3></div><div class="adv-card"><h2>Свои программисты</h2><h3>Внедрения на сайте</h3></div><div class="adv-card"><h2>Опыт с 2004 года</h2><h3>Проект ведет SEO-специалист</h3></div><div class="adv-card"><h2>Нейросети</h2><h3>В составе SEO без доплаты</h3></div></div>'
 if(slide.kind==='PORTFOLIO'){
  const topics=new Set(tokens(research.keywords.map(k=>k.keyword).join(' ')))
  const related=(label:string)=>tokens(label).filter(t=>topics.has(t)).length
  const examples=[...portfolio.items].sort((a,b)=>related(b.label)-related(a.label))
  body=`<div class="portfolio-head"><span>Примеры работ в разных нишах. Полный снимок по клику.</span></div><div class="portfolio-grid">${examples.map(item=>`<a class="portfolio-case" href="https://skyseo.site/cases/serp/${item.id}.jpg"><img src="${asset(`portfolio/${item.id}.jpg`,'image/jpeg')}"><span>${esc(item.label)}</span></a>`).join('')}</div>`
 }
 if(slide.kind==='NEXT'){
  const confirmed=research.trial==='CONFIRMED';className='test-close'
  body=`<div class="test-close-layout"><div class="test-close-copy"><div class="test-close-offer">${confirmed?'5 дней бесплатно на вашем сайте':research.trial==='UNAVAILABLE'?'Подготовим индивидуальный план':'Проверим, подходит ли бесплатный тест'}</div><ol class="test-close-steps">${(confirmed?['Подберем подходящие запросы.','Проведем тестовое продвижение.','Покажем динамику позиций.']:['Выберем приоритетное направление.','Специалист оценит задачи сайта.','Согласуем формат и следующий шаг.']).map(t=>`<li>${t}</li>`).join('')}</ol></div><div class="test-close-art"><img src="${asset('free-test-still-life.png')}"></div></div>`
 }
 if(slide.kind==='KEYWORDS')body=`<div class="keyword-grid">${research.keywords.slice(slide.keywordOffset,slide.keywordOffset!+20).map((k,i)=>`<div class="keyword-row"><b>${slide.keywordOffset!+i+1}</b><span>${esc(k.keyword)}${k.measuredAt&&!k.error?`<small>Позиция ${rank(k.position,k.scanned)}, ${date(k.measuredAt)}</small>`:''}</span></div>`).join('')}</div><p class="appendix-note">${research.keywords.length} запросов по проверенным страницам. ${esc(research.region.name)}. Это рабочая выборка, не полное ядро.</p>`
 return `<section class="slide ${className}" data-slide-id="${esc(slide.id)}" data-slide-number="${index+1}"><header><div class="brand"><img src="data:image/svg+xml;base64,${LOGO_SVG_B64}"><b>SkySEO</b></div><span>${esc(research.domain)}</span></header><div class="slide-title"><h1>${esc(slide.title)}</h1></div><div class="slide-body">${body}</div></section>`
}
export function renderResearchPresentation(research:Research,outline=buildSlideOutline(research),onlySlide?:number){
 const slides=onlySlide===undefined?outline:outline.filter((_,i)=>i===onlySlide)
 const extra='.slide-title{height:auto;min-height:24mm;margin:5mm 0 5mm}.slide-title h1{font-size:27pt}.slide-body{height:104mm}.slide header{height:9mm}.source-note{position:static}.takeaway{position:static}.keyword-row small{display:block;color:#666;font-size:7pt;margin-top:1mm}.comp-note{margin-top:2mm}.slide.opportunity h1{font-size:22pt}.slide.test-close h1{font-size:27pt}.slide.test-close .slide-title{min-height:27mm;margin-top:4mm}.slide.test-close .slide-body{height:87mm}'
 return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(research.companyName)}: SEO</title><style>${CALL_PRESENTATION_CSS}${style}${extra}</style></head><body>${slides.map(s=>slideHtml(research,s,outline.indexOf(s))).join('')}</body></html>`
}
/** Legacy report entry uses the same deck builder; unavailable evidence never makes an empty slide. */
export function renderCallPresentationHtml(data:ReportData){
 const research:Research={version:1,domain:data.domain,companyName:data.companyName||data.domain,region:{name:data.region||'Регион не сохранен',lr:0,assumed:!data.region},sitePages:[],keywords:data.keywords.map(k=>({...k,clientEvidenceUrl:k.competitors[0]?.url||'',group:k.keyword,url:null,scanned:k.position||0,top10:k.competitors,measuredAt:data.measuredAt?.toISOString(),volumeAt:undefined,volumeRegion:undefined})),comparisons:[],issues:[],completed:[],trial:'UNCONFIRMED',createdAt:data.generatedAt.toISOString()}
 return renderResearchPresentation(research)
}
