import 'reflect-metadata'
import {strict as assert} from 'node:assert'
import {plainToInstance} from 'class-transformer'
import {validate} from 'class-validator'
import {publicAddress,publicUrl} from '../crm/preparation/public-web'
import {rankResult} from '../crm/preparation/search'
import {siteCandidates,relevant,comparePages} from '../crm/preparation/research'
import {buildSlideOutline,renderResearchPresentation} from '../report/call-presentation.template'
import {buildCallScript} from '../crm/call-script'
import {renderCallScriptHtml} from '../crm/call-script.pdf'
import {PrepareCallDto} from '../crm/preparation/dto'
import {UpdateLeadDto} from '../crm/dto'
import {getWordstatHints} from '../common/yandex-positions'
import type {Research,PageEvidence} from '../crm/preparation/types'
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7r8AAAAASUVORK5CYII='
export function fixtureResearch():Research{
 const page:PageEvidence={url:'https://fixture.example/catalog/pumps',title:'Гидронасосы',headings:['Гидронасосы Bosch Rexroth'],text:'Купить гидронасос Bosch Rexroth. Каталог моделей и технические характеристики.',links:[{text:'Гидронасосы',url:'https://fixture.example/catalog/pumps'},{text:'Bosch Rexroth',url:'https://fixture.example/catalog/rexroth'}],capturedAt:'2026-10-13T08:00:00.000Z',image}
 return {version:1,domain:'fixture.example',companyName:'Тестовая компания',region:{name:'Москва',lr:213,assumed:false},sitePages:[page],keywords:[{keyword:'гидронасос bosch rexroth',group:'Гидронасосы',clientEvidenceUrl:page.url,position:3,url:page.url,scanned:50,top10:[{domain:'competitor.example',position:1,url:'https://competitor.example/catalog'}],measuredAt:'2026-10-13T08:05:00.000Z',source:'Test fixture',volume:1000,volumeAt:'2026-10-13T08:00:00.000Z',volumeRegion:213}],comparisons:[{id:'comparison-test',feature:'Содержание страницы',keyword:'гидронасос bosch rexroth',clientUrl:page.url,clientPosition:3,scanned:50,competitor:{domain:'competitor.example',position:1,url:'https://competitor.example/catalog'},clientFinding:'Есть раздел насосов',competitorFinding:'Есть характеристики моделей',apply:'Уточним параметры на товарных страницах',benefit:'Сопоставим страницу с запросом',capturedAt:page.capturedAt,image}],issues:[],completed:['SITE','KEYWORDS','POSITIONS','COMPETITORS','DOCUMENTS'],trial:'UNCONFIRMED',createdAt:'2026-10-13T08:00:00.000Z'}
}
async function main(){
 for(const ip of ['127.0.0.1','10.1.2.3','172.16.0.1','192.168.0.1','169.254.169.254','100.64.0.1','::1','::ffff:127.0.0.1','fc00::1','2001:db8::1'])assert.equal(publicAddress(ip),false,ip)
 assert.equal(publicAddress('8.8.8.8'),true)
 for(const url of ['http://127.1','http://2130706433','http://0x7f000001','http://localhost','file:///etc/passwd','https://user:pass@public.example','http://example.local','http://example.com:4000'])assert.throws(()=>publicUrl(url),url)
 const xml='<doc><url>https://fixture.example.evil.org/</url></doc><doc><url>https://shop.fixture.example/catalog?a=1&amp;b=2</url></doc>'
 const result=rankResult(xml,'fixture.example','запрос',213);assert.equal(result.position,2);assert.equal(result.scanned,2);assert.ok(result.url?.includes('&b=2'))
 assert.equal(rankResult('<doc><url>https://other.example/</url></doc>','fixture.example','запрос',213).scanned,1)
 assert.throws(()=>rankResult('<error>quota exceeded</error>','fixture.example','запрос',213))
 const research=fixtureResearch(),page=research.sitePages[0]
 assert.equal(relevant('скачать фильм бесплатно',page),false)
 assert.ok(siteCandidates([page],['гидронасос bosch rexroth','ипотека купить'],20).every(k=>!k.keyword.includes('ипотека')))
 const comparison=comparePages(page,{...page,url:'https://competitor.example/catalog',text:'Гидронасос Bosch Rexroth. Мощность, напряжение, давление.',links:[]},research.keywords[0],research.comparisons[0].competitor)
 assert.ok(comparison?.apply);assert.equal(comparePages(page,{...page,url:'https://competitor.example/catalog'},research.keywords[0],research.comparisons[0].competitor),null,'Identical pages do not prove a competitor advantage');assert.ok(!comparison?.clientFinding.includes('нет'))
 const slides=buildSlideOutline(research),script=buildCallScript({firstName:'Иван',crmLead:{qualification:{seoGoal:'Больше заявок',hasSeo:'NO',budgetComment:'Записано'},budgetComment:'50000'}},null,{research,slides})
 for(const step of script.steps)for(const number of step.slides)assert.ok(slides[number-1],step.id)
 const compStep=script.steps.find(s=>s.id==='comparison-test')!;assert.equal(slides[compStep.slides[0]-1].kind,'COMPARISON');assert.ok(compStep.say.includes('competitor.example')&&compStep.say.includes('3-м'))
 assert.ok(script.steps.find(s=>s.id==='potential')?.say.includes('1,8'))
 assert.ok(script.steps.find(s=>s.id==='test')?.say.includes('проверит, подходит'))
 assert.ok(script.steps.find(s=>s.id==='discovery')?.questions.find(q=>q.key==='seoGoal')?.known)
 const reduced={...research,comparisons:[],keywords:research.keywords.map(k=>({...k,volume:null}))}
 const reducedSlides=buildSlideOutline(reduced),reducedScript=buildCallScript({},null,{research:reduced,slides:reducedSlides})
 assert.ok(!reducedSlides.some(s=>s.kind==='COMPARISON'||s.kind==='POTENTIAL'))
 assert.ok(!reducedScript.steps.some(s=>s.id==='comparison-test'||s.id==='potential'))
 assert.equal(reducedSlides[reducedScript.steps.find(s=>s.id==='case')!.slides[0]-1].kind,'CASE')
 const html=renderResearchPresentation(research,slides);assert.ok(html.includes('data-slide-id="comparison-test"'));assert.ok(!/[·•⋮]/.test(html.replace(/data:[^"']+/g,'')))
 const notes=renderCallScriptHtml(script);assert.ok(notes.includes('font-size:14pt')&&!notes.includes('height:297mm'));assert.ok(notes.includes('Иван'))
 assert.deepEqual(await validate(plainToInstance(UpdateLeadDto,{qualification:{hasSeo:'UNKNOWN',seoSatisfied:'UNKNOWN',callStepId:'positions',callQuestionKey:'callQueryRelevance',callPreparationVersion:2,callCaseComment:'Кейс'}}),{whitelist:true,forbidNonWhitelisted:true}),[])
 assert.ok((await validate(plainToInstance(PrepareCallDto,{maxKeywords:500}))).length)
 const original=global.fetch;let requestUrl=''
 global.fetch=(async(url:any)=>{requestUrl=String(url);return new Response(JSON.stringify({popular:[{text:'гидронасос',value:2},{text:'гидронасос bosch rexroth',value:1000}],associations:[]}),{status:200})}) as typeof fetch
 try{const hints=await getWordstatHints({user:'fixture',key:'fixture',keyword:'гидронасос',lr:213});assert.equal(new URL(requestUrl).searchParams.get('regions'),'213');assert.equal(new URL(requestUrl).searchParams.get('lr'),null);assert.equal(hints.popular.length,2)}finally{global.fetch=original}
 console.log('Preparation: public-network guard, exact domain matching, evidence-based keywords/comparisons, dynamic slide mapping, truthful omissions, shared script/PDF and CRM DTO contracts passed.')
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1})
