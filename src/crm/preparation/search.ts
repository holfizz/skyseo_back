import { hostOf, parseResultUrls, parseError, getWordstatHints } from '../../common/yandex-positions'
import { SearchEvidence } from './types'
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms))
let lastSearchAt=0
async function searchTurn(){const now=Date.now(),at=Math.max(now,lastSearchAt+1200);lastSearchAt=at;await sleep(at-now)}
export class SourceUnavailable extends Error { constructor(message:string,public quota=false){super(message)} }
export function rankResult(xml:string,domain:string,keyword:string,lr:number): Partial<SearchEvidence> {
 const error=parseError(xml)
 if(error)throw new SourceUnavailable('Источник поиска вернул ошибку',/баланс|лимит|quota|balance/i.test(error))
 const urls=parseResultUrls(xml);if(!urls.length)throw new SourceUnavailable('Источник поиска вернул пустую выдачу');const host=hostOf(domain)
 const index=urls.findIndex(url=>{const h=hostOf(url);return h===host||h.endsWith('.'+host)})
 return {keyword,position:index<0?null:index+1,url:index<0?null:urls[index],scanned:urls.length,top10:urls.slice(0,10).map((url,i)=>({position:i+1,domain:hostOf(url),url})),measuredAt:new Date().toISOString()}
}
export async function measureKeyword(domain:string,keyword:string,lr:number):Promise<Partial<SearchEvidence>> {
 const apiKey=process.env.YANDEX_SEARCH_API_KEY,folderId=process.env.YANDEX_FOLDER_ID
 if(apiKey&&folderId){
  for(let attempt=0;attempt<2;attempt++){
   try {
    await searchTurn()
    const response=await fetch('https://searchapi.api.cloud.yandex.net/v2/web/search',{method:'POST',headers:{Authorization:`Api-Key ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({query:{searchType:'SEARCH_TYPE_RU',queryText:keyword,page:'0'},groupSpec:{groupMode:'GROUP_MODE_FLAT',groupsOnPage:'50',docsInGroup:'1'},region:String(lr),folderId,responseFormat:'FORMAT_XML'}),signal:AbortSignal.timeout(30000)})
    if(response.status===429&&attempt===0){await sleep(Math.min(10000,Math.max(1500,Number(response.headers.get('retry-after')||0)*1000)));continue}
    if([401,403,429].includes(response.status))throw new SourceUnavailable(`Search API: HTTP ${response.status}`,response.status===429)
    if(!response.ok)throw new Error('Источник поиска временно недоступен')
    const json=await response.json() as any
    if(!json.rawData)throw new Error('Search API вернул пустой ответ')
    return {...rankResult(Buffer.from(json.rawData,'base64').toString('utf8'),domain,keyword,lr),source:'Yandex Search API v2'}
   }catch(error){if(error instanceof SourceUnavailable||attempt===1)throw error;await sleep(1200)}
  }
 }
 const user=process.env.XMLRIVER_USER,key=process.env.XMLRIVER_KEY
 if(!user||!key)throw new SourceUnavailable('Не настроен источник позиций Яндекса')
 const all:string[]=[]
 for(let page=0;page<5;page++){
  const u=new URL('https://xmlriver.com/search_yandex/xml');for(const [k,v]of Object.entries({user,key,query:keyword,groupby:'10',page:String(page),domain:'ru',lang:'ru',lr:String(lr)}))u.searchParams.set(k,v)
  let response:Response
  try{response=await fetch(u,{signal:AbortSignal.timeout(25000)})}catch{throw new SourceUnavailable('XMLRiver: сеть недоступна')}
  if(!response.ok)throw new SourceUnavailable(`XMLRiver: HTTP ${response.status}`,[403,429].includes(response.status))
  const xml=await response.text(),error=parseError(xml)
  if(error)throw new SourceUnavailable('XMLRiver: источник вернул ошибку',/баланс|лимит|quota|balance/i.test(error))
  const urls=parseResultUrls(xml);if(!urls.length)break;all.push(...urls)
 }
 const xml=all.map(url=>`<doc><url>${url.replace(/&/g,'&amp;')}</url></doc>`).join('')
 return {...rankResult(xml,domain,keyword,lr),source:'XMLRiver Yandex XML'}
}
export async function keywordHints(keyword:string,lr:number){
 if(!process.env.XMLRIVER_USER||!process.env.XMLRIVER_KEY)throw new SourceUnavailable('Wordstat не настроен')
 const result=await getWordstatHints({user:process.env.XMLRIVER_USER,key:process.env.XMLRIVER_KEY,keyword,lr})
 if(result.error)throw new SourceUnavailable(`Wordstat: ${result.error}`,/баланс|лимит|quota|balance/i.test(result.error))
 return result
}
