import { hostOf } from '../../common/yandex-positions'
import { PageEvidence, SearchEvidence, ComparisonEvidence } from './types'
const stop=/^(главная|каталог|товары|услуги|контакты|о компании|о нас|новости|статьи|доставка|оплата|гарантия|поиск|корзина|личный кабинет|войти|подробнее|показать|читать|все|меню|купить|заказать|телефон|email|бренды|производители|обратная связь)$/i
export function tokens(text:string){return (text.toLowerCase().replace(/ё/g,'е').match(/[а-яa-z0-9]+/g)||[]).filter(word=>(word.length>2||/^[a-z0-9]{2}$/.test(word))&&!/^(купить|цена|цены|стоимость|заказать|москва|продажа|доставка|скачать|россия|для|или|компании|официальный|сайт|www|com)$/.test(word)).map(word=>/[а-я]/.test(word)&&word.length>6?word.slice(0,6):word)}
export function relevant(keyword:string,page:PageEvidence){const words=tokens(keyword),hay=tokens(page.title+' '+page.headings.join(' ')+' '+(page.contentText??page.text));return words.length>0&&words.filter(word=>hay.includes(word)).length>=Math.ceil(words.length*.75)}
export function pageMatchScore(keyword:string,page:Pick<PageEvidence,'title'|'headings'>){const words=tokens(keyword),title=tokens(page.title),headings=tokens(page.headings.join(' '));return words.length?words.reduce((sum,word)=>sum+((title.includes(word)?2:0)+(headings.includes(word)?2:0))*(/[a-z0-9]/.test(word)?3:1),0)/words.reduce((sum,word)=>sum+(/[a-z0-9]/.test(word)?3:1),0):0}
export function siteCandidates(pages:PageEvidence[],existing:string[]=[],limit=40):SearchEvidence[]{
 const found=new Map<string,SearchEvidence>()
 const add=(keyword:string,page:PageEvidence,group:string)=>{
  keyword=keyword.replace(/\s+/g,' ').trim()
  if(keyword.length<4||keyword.length>90||!tokens(keyword).length||stop.test(keyword)||!/^[а-яa-z0-9\s.,+()\-–]+$/i.test(keyword)||/ваканси|работа |реферат|инструкци|бесплатно|скачать|новости|политик|cookie/i.test(keyword))return
  const key=keyword.toLowerCase().replace(/ё/g,'е')
  if(!found.has(key))found.set(key,{keyword,group:group.slice(0,70),clientEvidenceUrl:page.url,position:null,url:null,scanned:0,top10:[],volume:null})
 }
 for(const keyword of existing){const page=pages.filter(p=>relevant(keyword,p)).sort((a,b)=>pageMatchScore(keyword,b)-pageMatchScore(keyword,a))[0];if(page)add(keyword,page,keyword)}
 for(const page of pages){
  const labels=[...page.headings,...page.links.filter(link=>{try{return hostOf(link.url)===hostOf(page.url)&&new URL(link.url).pathname.length>2&&!/about|contact|news|blog|dostav|oplata|policy|cart|login/i.test(link.url)}catch{return false}}).map(link=>link.text)]
  for(const label of labels){if(stop.test(label)||label.split(' ').length>8)continue;add(label,page,label);if(!/купить|ремонт|аренда|заказ|услуг|монтаж|обслужив/i.test(label))add(`${label} купить`,page,label)}
 }
 return [...found.values()].slice(0,limit)
}
export function selectCompetitors(keywords:SearchEvidence[],clientDomain:string){
 const candidates=new Map<string,{domain:string;url:string;position:number;keyword:SearchEvidence;score:number}>()
 for(const keyword of keywords.filter(k=>!k.error&&k.measuredAt))for(const rival of keyword.top10){
  if(rival.domain.split('.')[0]===clientDomain.split('.')[0]||rival.domain===clientDomain||rival.domain.endsWith('.'+clientDomain)||/(^|\.)(yandex\.|ya\.ru|ozon\.|wildberries\.|avito\.|youtube\.|wikipedia\.|2gis\.|market\.)/.test(rival.domain))continue
  const current=candidates.get(rival.domain)
  const score=(current?.score||0)+1
  if(!current||rival.position<current.position)candidates.set(rival.domain,{...rival,keyword,score});else current.score=score
 }
 return [...candidates.values()].sort((a,b)=>b.score-a.score||a.position-b.position).slice(0,8)
}
export function comparePages(client:PageEvidence,other:PageEvidence,keyword:SearchEvidence,rival:{domain:string;url:string;position:number}):ComparisonEvidence|null{
 if(!other.image||!relevant(keyword.keyword,other)||!relevant(keyword.keyword,client)||pageMatchScore(keyword.keyword,client)<1)return null
 const host=hostOf(other.url)
 const related=(page:PageEvidence)=>page.links.filter(l=>!l.navigation&&hostOf(l.url)===hostOf(page.url)&&!stop.test(l.text)&&l.text.length>3&&l.text.length<75&&!/contact|about|login|cart|policy/i.test(l.url)&&pageMatchScore(keyword.keyword,{title:l.text,headings:[l.text]})>=2)
 const unique=(links:typeof client.links)=>[...new Map(links.map(l=>[l.text.toLowerCase(),l])).values()]
 const clientLinks=unique(related(client)),otherLinks=unique(related(other))
 const distinctLinks=otherLinks.filter(l=>!clientLinks.some(c=>c.text.toLowerCase()===l.text.toLowerCase()))
 const params=['мощность','напряжение','производительность','давление','диаметр','частота вращения','крутящий момент','рабочая температура','масса','габариты']
 const specs=(page:PageEvidence)=>params.filter(p=>(page.contentText??page.text).toLowerCase().includes(p))
 const clientSpecs=specs(client),otherSpecs=specs(other),additional=otherSpecs.filter(p=>!clientSpecs.includes(p))
 let feature:string,clientFinding:string,competitorFinding:string,apply:string,benefit:string
 if(additional.length>=2){
  feature='Параметры оборудования';clientFinding=clientSpecs.length?clientSpecs.slice(0,3).join(', '):client.headings[0]?.slice(0,60)||client.title.slice(0,60)
  competitorFinding=otherSpecs.slice(0,3).join(', ');apply=`Дополнить страницу: ${additional.slice(0,2).join(', ')}`;benefit='Ответы на более точные поисковые запросы'
 }else if(distinctLinks.length>=2){
  feature='Разделы по направлениям';clientFinding=clientLinks.length?clientLinks.slice(0,2).map(l=>l.text).join(', '):client.headings[0]?.slice(0,60)||client.title.slice(0,60)
  competitorFinding=distinctLinks.slice(0,2).map(l=>l.text).join(', ')
  apply='Проверить спрос и выделить нужные группы';benefit='Отдельная страница под отдельный запрос'
 }else return null
 return {id:'comparison-'+host.replace(/[^a-z0-9]/g,'-'),keyword:keyword.keyword,clientUrl:client.url,clientPosition:keyword.position,scanned:keyword.scanned,competitor:{domain:rival.domain,position:rival.position,url:other.url},clientFinding:clientFinding||'Есть страница направления',competitorFinding:competitorFinding.slice(0,100),apply,benefit,capturedAt:other.capturedAt,image:other.image,clientImage:client.image,feature}
}
