import 'reflect-metadata'
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs'
import {resolve,join} from 'node:path'
import {runPreparation} from '../crm/preparation/pipeline'
import {publicUrl} from '../crm/preparation/public-web'
import {resolveRegion,hostOf} from '../common/yandex-positions'
import {Research} from '../crm/preparation/types'
import {PHASES,PreparationPhase} from '../crm/preparation/types'
import {buildSlideOutline,renderResearchPresentation} from '../report/call-presentation.template'
import {buildCallScript} from '../crm/call-script'
import {renderCallScriptHtml} from '../crm/call-script.pdf'
const option=(key:string)=>{const i=process.argv.indexOf('--'+key);return i>=0?process.argv[i+1]:undefined}
async function main(){
 // Only research credentials are read; Telegram sessions and bot settings are excluded.
 if(existsSync('.env'))for(const line of readFileSync('.env','utf8').split(/\r?\n/)){const match=/^(XMLRIVER_USER|XMLRIVER_KEY|YANDEX_SEARCH_API_KEY|YANDEX_FOLDER_ID)=(.*)$/.exec(line);if(match&&!process.env[match[1]])process.env[match[1]]=match[2].trim().replace(/^['"]|['"]$/g,'')}
 const site=option('site');if(!site)throw new Error('Укажите --site и --region')
 const domain=hostOf(publicUrl(site).href),region=resolveRegion(option('region'))
 if(/не распознан/.test(region.city))throw new Error('Нужен город или числовой код региона Яндекса')
 const limit=Number(option('limit')||40);if(!Number.isInteger(limit)||limit<8||limit>100)throw new Error('--limit должен быть от 8 до 100')
 const directory=resolve(option('out')||join('docs/clients',domain.replace(/[^a-z0-9-]/g,'-'),'prepared-call'))
 mkdirSync(directory,{recursive:true})
 const checkpoint=join(directory,'research.json')
 let research:Research
 if(process.argv.includes('--resume')&&existsSync(checkpoint)){
  research=JSON.parse(readFileSync(checkpoint,'utf8')).research
  if(research.domain!==domain||research.region.lr!==region.lr)throw new Error('Сайт или регион не совпадает с контрольной точкой')
 }else research={version:1,domain,siteUrl:publicUrl(site).origin,companyName:option('name')||domain,region:{name:region.city,lr:region.lr,assumed:!option('region')},sitePages:[],keywords:[],comparisons:[],issues:[],completed:[],trial:option('trial')==='confirmed'?'CONFIRMED':option('trial')==='unavailable'?'UNAVAILABLE':'UNCONFIRMED',createdAt:new Date().toISOString()}
 ;research.maxKeywords=limit
 const retry=option('retry-phase') as PreparationPhase|undefined
 if(retry){if(!PHASES.includes(retry))throw new Error('Неизвестный этап');research.completed=research.completed.filter(p=>PHASES.indexOf(p)<PHASES.indexOf(retry));research.issues=research.issues.filter(i=>PHASES.indexOf(i.phase)<PHASES.indexOf(retry));if(PHASES.indexOf(retry)<=2)research.comparisons=[]}
 const context={company:research.companyName,domain,firstName:option('contact')||null,crmLead:{title:research.companyName,qualification:{}}}
 const clientFile=join(directory,'CLIENT_PRESENTATION.pdf'),scriptFile=join(directory,'CALL_SCRIPT.pdf')
 let cachedClient:Buffer|null=process.argv.includes('--resume')&&(!retry||retry==='DOCUMENTS')&&existsSync(clientFile)?readFileSync(clientFile):null
 let lastPhase=''
 let existing:string[]=[]
 if(option('keywords')){const data=JSON.parse(readFileSync(resolve(option('keywords')!),'utf8'));existing=(Array.isArray(data)?data:data.keywords||data.allKeywords||data.rows||[]).map((r:any)=>typeof r==='string'?r:r.keyword||r.phrase).filter(Boolean)}
 const result=await runPreparation(research,context,{
  clientPdf:async()=>cachedClient,
  save:async(r,phase,extra={})=>{
   if(extra.clientPdf){cachedClient=extra.clientPdf as Buffer;writeFileSync(clientFile,cachedClient)}
   if(extra.scriptPdf)writeFileSync(scriptFile,extra.scriptPdf as Buffer)
   writeFileSync(checkpoint,JSON.stringify({research:r,phase,status:extra.status||'RUNNING',error:extra.error||null},null,2))
   if(phase!==lastPhase){console.log(phase);lastPhase=phase}
  },
 },existing)
 if(result.status==='FAILED')throw new Error(result.error)
 const slides=buildSlideOutline(research),script=buildCallScript(context,null,{research,slides})
 writeFileSync(join(directory,'slides.json'),JSON.stringify(slides,null,2));writeFileSync(join(directory,'call-script.json'),JSON.stringify(script,null,2))
 writeFileSync(join(directory,'CLIENT_PRESENTATION.html'),renderResearchPresentation(research,slides));writeFileSync(join(directory,'CALL_SCRIPT.html'),renderCallScriptHtml(script))
 console.log(JSON.stringify({status:result.status,domain,region:region.city,keywords:research.keywords.length,measured:research.keywords.filter(k=>k.measuredAt&&!k.error).length,comparisons:research.comparisons.length,slides:slides.length,issues:research.issues,directory}))
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Подготовка не завершена');process.exitCode=1})
