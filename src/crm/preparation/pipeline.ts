import {hostOf} from '../../common/yandex-positions'
import {publicBrowser,inspectPage} from './public-web'
import {siteCandidates,selectCompetitors,comparePages,relevant,pageMatchScore} from './research'
import {keywordHints,measureKeyword,SourceUnavailable} from './search'
import {PHASES,Research,PreparationPhase} from './types'
import {buildSlideOutline,renderResearchPresentation} from '../../report/call-presentation.template'
import {buildCallScript} from '../call-script'
import {renderCallScriptHtml} from '../call-script.pdf'
import {renderPdf} from '../../report/report.pdf'
export type PipelineContext={id?:string;firstName?:string|null;middleName?:string|null;lastName?:string|null;domain?:string|null;company?:string|null;followUpTask?:{dueAt:Date|string;status?:string}|null;crmLead:{title:string;outreachLeadId?:string|null;budgetMin?:number|null;budgetMax?:number|null;budgetComment?:string|null;decisionMaker?:string|null;qualification?:unknown;tasks?:Array<{kind:string;dueAt:Date|string;followUpRecipientId?:string|null}>}}
export type PipelineStorage={save:(research:Research,phase:PreparationPhase,extra?:Record<string,unknown>)=>Promise<void>;clientPdf:()=>Promise<Buffer|null>}
/** One research/rendering engine for queued CRM jobs and local website delivery. */
export async function runPreparation(research:Research,context:PipelineContext,adapter:PipelineStorage,existingKeywords:string[]=[]){
  let browser:any,phase:PreparationPhase='SITE'
  const checkpoint=(extra:Record<string,unknown>={})=>adapter.save(research,phase,extra)
  const issue=(message:string)=>{if(!research.issues.some(i=>i.phase===phase&&i.message===message))research.issues.push({phase,message})}
  try{
   const limit=research.maxKeywords||40
   for(phase of PHASES){
    if(research.completed.includes(phase))continue
    await checkpoint()
    if(phase==='SITE'){
     browser=await publicBrowser()
     const root=await inspectPage(browser,research.siteUrl||`https://${research.domain}`)
     research.sitePages=[root];await checkpoint()
     const urls=root.links.filter(l=>hostOf(l.url)===research.domain&&!/contact|login|cart|policy|about|news|blog/i.test(l.url)&&l.text.length>3).map(l=>l.url)
     try{const {readPublic}=await import('./public-web');const sitemap=await readPublic(new URL('/sitemap.xml',root.url).href,500000);if(sitemap.status===200)urls.push(...[...sitemap.body.toString('utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map(m=>m[1].replace(/&amp;/g,'&')))}catch{}
     const canonical=(value:string)=>{const u=new URL(value);u.hash='';return u.href}
     for(const url of [...new Set(urls.map(canonical))].filter(u=>u!==canonical(root.url)).slice(0,8)){
      try{const page=await inspectPage(browser,url,research.sitePages.length<3);if(page.text.length>120){research.sitePages.push(page);await checkpoint()}}catch{issue('Часть страниц сайта недоступна. Выводы по ним не сделаны')}
     }
     if(root.title&&research.companyName===research.domain)research.companyName=root.title.split(/[|—]/)[0].trim().slice(0,120)||research.companyName
    }
    if(phase==='KEYWORDS'){
     const existing=existingKeywords
     const candidates=siteCandidates(research.sitePages,existing,limit)
     research.keywords=[...research.keywords.filter(k=>research.sitePages.some(p=>relevant(k.keyword,p))),...candidates.filter(k=>!research.keywords.some(saved=>saved.keyword.toLowerCase()===k.keyword.toLowerCase()))].slice(0,limit)
     if(!research.keywords.length)throw new Error('Не удалось подтвердить темы запросов по страницам сайта')
     const seeds=research.keywords.slice(0,8)
     for(const seed of seeds){
      if(seed.wordstatSeedCompleted)continue
      try{
       const result=await keywordHints(seed.keyword,research.region.lr),time=new Date().toISOString()
       for(const hint of result.popular){
        const page=research.sitePages.find(p=>relevant(hint.text,p))
        if(!page)continue
        let row=research.keywords.find(k=>k.keyword.toLowerCase()===hint.text.toLowerCase())
        if(!row&&research.keywords.length<limit){row={...seed,keyword:hint.text,clientEvidenceUrl:page.url,volume:null,position:null,url:null,scanned:0,top10:[],measuredAt:undefined,source:undefined,error:undefined,wordstatSeedCompleted:false};research.keywords.push(row)}
        if(row){row.volume=hint.value;row.volumeAt=time;row.volumeRegion=research.region.lr;row.volumePeriod='Широкое соответствие, период ответа Wordstat'}
       }
       seed.wordstatSeedCompleted=true;await checkpoint()
      }catch(error){issue(error instanceof SourceUnavailable?error.message:'Wordstat временно недоступен');if(error instanceof SourceUnavailable&&error.quota)break}
     }
    }
    if(phase==='POSITIONS'){
     for(const row of research.keywords){
      if(row.measuredAt&&!row.error)continue
      try{Object.assign(row,await measureKeyword(research.domain,row.keyword,research.region.lr));delete row.error}
      catch(error){row.error=error instanceof SourceUnavailable?error.message:'Замер позиций не завершен';issue(row.error);await checkpoint();if(error instanceof SourceUnavailable)break}
      await checkpoint()
     }
     if(!research.keywords.some(k=>k.measuredAt&&!k.error))issue('Позиции не подтверждены. Слайд позиций исключен')
    }
    if(phase==='COMPETITORS'){
     browser ||= await publicBrowser()
     for(const rival of selectCompetitors(research.keywords,research.domain)){
      if(research.comparisons.length>=3)break
      if(research.comparisons.some(c=>c.competitor.domain===rival.domain))continue
      try{
       const other=await inspectPage(browser,rival.url)
       let client=research.sitePages.find(p=>p.url===rival.keyword.url)||research.sitePages.filter(p=>relevant(rival.keyword.keyword,p)).sort((a,b)=>pageMatchScore(rival.keyword.keyword,b)-pageMatchScore(rival.keyword.keyword,a))[0]
       const links=research.sitePages.flatMap(p=>p.links).filter(l=>hostOf(l.url)===research.domain)
       const target=rival.keyword.url||links.filter(l=>pageMatchScore(rival.keyword.keyword,{title:l.text,headings:[l.text]} as any)>=1).sort((a,b)=>tokensScore(b.text)-tokensScore(a.text))[0]?.url
       function tokensScore(text:string){return pageMatchScore(rival.keyword.keyword,{title:text,headings:[text]} as any)}
       if(target&&!research.sitePages.some(p=>p.url===target))try{const page=await inspectPage(browser,target);research.sitePages.push(page);if(relevant(rival.keyword.keyword,page))client=page;await checkpoint()}catch{}
       if(client){const deeper=client.links.filter(l=>hostOf(l.url)===research.domain&&pageMatchScore(rival.keyword.keyword,{title:l.text,headings:[l.text]})>pageMatchScore(rival.keyword.keyword,client!)).sort((a,b)=>tokensScore(b.text)-tokensScore(a.text))[0];if(deeper&&!research.sitePages.some(p=>p.url===deeper.url))try{const page=await inspectPage(browser,deeper.url);research.sitePages.push(page);if(relevant(rival.keyword.keyword,page))client=page;await checkpoint()}catch{}}
       if(!client)continue
       const comparison=comparePages(client,other,rival.keyword,rival)
       if(comparison){research.comparisons.push(comparison);await checkpoint()}
      }catch{issue('Не все сопоставимые страницы конкурентов удалось проверить')}
     }
     if(!research.comparisons.length)issue('Нет подтвержденного сравнения страниц. Пустые слайды не создаются')
    }
    if(phase==='DOCUMENTS'){
     // Close the research browser before launching PDF Chromium: one heavy browser at a time.
     if(browser){await browser.close();browser=null}
     const slides=buildSlideOutline(research),script=buildCallScript(context,null,{research,slides})
     const clientPdf=await adapter.clientPdf()||await renderPdf(renderResearchPresentation(research,slides))
     await checkpoint({slideOutline:slides,clientPdf})
     const scriptPdf=await renderPdf(renderCallScriptHtml(script),true)
     await checkpoint({scriptPdf})
    }
    research.completed.push(phase);await checkpoint()
   }
   const status=research.issues.length?'PARTIAL':'READY'
   await checkpoint({status,generatedAt:new Date(),leaseUntil:null,error:null})
   return {status,phase}
  }catch(error){
   const message=error instanceof SourceUnavailable?error.message:error instanceof Error&&/^(Не удалось|Страница|Сайт|Нужен|Внутренние|Адрес|Подготовка)/.test(error.message)?error.message:'Этап подготовки не завершен. Полученные материалы сохранены'
   await checkpoint({status:'FAILED',error:message,leaseUntil:null})
   return {status:'FAILED',phase,error:message}
  }finally{if(browser)await browser.close().catch(()=>{})}
}
