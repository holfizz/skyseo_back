import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { resolveChrome } from '../../report/report.pdf'
import type { PageEvidence } from './types'

export function publicAddress(address: string): boolean {
 const ip = address.toLowerCase().replace(/^\[|\]$/g, '')
 if (isIP(ip) === 4) {
  const [a,b,c] = ip.split('.').map(Number)
  return !(a===0 || a===10 || a===127 || a>=224 || a===169&&b===254 || a===172&&b>=16&&b<=31 || a===192&&b===168 || a===100&&b>=64&&b<=127 || a===198&&[18,19].includes(b) || a===192&&b===0 || a===198&&b===51&&c===100 || a===203&&b===0&&c===113)
 }
 if (isIP(ip) === 6) return /^2[0-9a-f]{3}:/.test(ip) && !ip.startsWith('2001:db8:') && !ip.startsWith('2001:0:') && !ip.startsWith('2002:')
 return false
}
export function publicUrl(raw: string): URL {
 const u=new URL(raw.includes('://')?raw:`https://${raw}`)
 if (!['http:','https:'].includes(u.protocol) || u.username || u.password || u.port && !['80','443'].includes(u.port)) throw new Error('Нужен публичный адрес сайта с HTTP или HTTPS')
 const host=u.hostname.replace(/^\[|\]$/g,'').toLowerCase()
 if (!host.includes('.') && !isIP(host) || /\.(localhost|local|internal|test|invalid)$/.test(host) || host==='localhost' || isIP(host)&&!publicAddress(host)) throw new Error('Внутренние адреса недоступны для анализа')
 return u
}
/** Every connection uses a validated, pinned DNS address; redirects are checked again. */
export async function readPublic(raw: string, limit=2_000_000, redirects=0): Promise<{body:Buffer;status:number;headers:Record<string,string>;url:string}> {
 const u=publicUrl(raw), host=u.hostname.replace(/^\[|\]$/g,'')
 const addresses=await lookup(host,{all:true})
 if (!addresses.length || addresses.some(a=>!publicAddress(a.address))) throw new Error('Адрес сайта не относится к публичной сети')
 const selected=addresses.find(a=>a.family===4)||addresses[0]
 const result=await new Promise<{body:Buffer;status:number;headers:Record<string,string>;url:string}>((resolve,reject)=>{
  const req=(u.protocol==='https:'?httpsRequest:httpRequest)(u,{headers:{'User-Agent':'Mozilla/5.0 SkySEO-SiteReview/1.0','Accept-Encoding':'identity'},lookup:((_hostname:any,options:any,cb:any)=>options.all?cb(null,[selected]):cb(null,selected.address,selected.family)) as any},res=>{
   const parts:Buffer[]=[];let bytes=0
   res.on('data',chunk=>{bytes+=chunk.length;if(bytes>limit){res.destroy(new Error('Страница превышает лимит размера'));return}parts.push(chunk)})
   res.on('error',reject)
   res.on('end',()=>resolve({body:Buffer.concat(parts),status:res.statusCode||0,headers:Object.fromEntries(Object.entries(res.headers).filter(([,v])=>typeof v==='string')) as Record<string,string>,url:u.href}))
  })
  req.setTimeout(15000,()=>req.destroy(new Error('Сайт не ответил за 15 секунд')));req.on('error',reject);req.end()
 })
 if ([301,302,303,307,308].includes(result.status)&&result.headers.location){if(redirects>=3)throw new Error('Слишком много перенаправлений');return readPublic(new URL(result.headers.location,u).href,limit,redirects+1)}
 return result
}
export async function publicBrowser() {
 const puppeteer=require('puppeteer-core')
 return puppeteer.launch({executablePath:resolveChrome(),headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-quic','--disable-features=WebRtcHideLocalIpsWithMdns','--force-webrtc-ip-handling-policy=disable_non_proxied_udp']})
}
export async function inspectPage(browser:any,raw:string, screenshot=true):Promise<PageEvidence> {
 publicUrl(raw)
 const page=await browser.newPage();let resources=0,totalBytes=0
 try {
  await page.setViewport({width:1366,height:900,deviceScaleFactor:1})
  await page.setRequestInterception(true)
  page.on('request',async (req:any)=>{
   try {
    if (req.url().startsWith('data:')) {await req.continue();return}
    if (++resources>65||totalBytes>12_000_000||!['GET','HEAD'].includes(req.method())||['media','websocket'].includes(req.resourceType())) {await req.abort();return}
    const r=await readPublic(req.url());totalBytes+=r.body.length
    // Cookies, credentials and original connection headers are never forwarded.
    await req.respond({status:r.status,headers:{'content-type':r.headers['content-type']||'text/html','content-security-policy': "connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; form-action 'none'"},body:r.body})
   } catch {await req.abort().catch(()=>{})}
  })
  const response=await page.goto(raw,{waitUntil:'domcontentloaded',timeout:35000})
  await new Promise(r=>setTimeout(r,700))
  const data=await page.evaluate(()=>{
   const clean=(s:string)=>s.replace(/\s+/g,' ').trim()
   const content=document.body.cloneNode(true) as HTMLElement
   content.querySelectorAll('header,footer,nav,script,style,aside,[role="navigation"]').forEach(e=>e.remove())
   return {title:document.title,headings:Array.from(document.querySelectorAll('h1,h2,h3')).map(e=>clean(e.textContent||'')).filter(Boolean).slice(0,35),contentText:clean(content.textContent||'').slice(0,18000),text:clean(document.body?.innerText||'').slice(0,18000),links:Array.from(document.querySelectorAll('a[href]')).map((e:any)=>({text:clean(e.innerText||e.textContent||''),url:e.href,navigation:!!e.closest('header,footer,nav,aside,[role="navigation"],.menu,.sidebar,.breadcrumbs,[class*="menu"]')})).filter(e=>e.text&&/^https?:/.test(e.url)).slice(0,600),logoUrl:(Array.from(document.images).find(e=>/logo|логотип/i.test(e.alt+' '+e.src))||Array.from(document.images)[0])?.src}
  })
  if (!response || response.status()>=400 || /captcha|botfaqtor|проверка браузера|подтвердите.*человек|доступ ограничен|access denied/i.test(data.title+' '+data.text.slice(0,1600))) throw new Error('Страница недоступна для достоверного анализа')
  const image=screenshot?`data:image/jpeg;base64,${Buffer.from(await page.screenshot({type:'jpeg',quality:78,fullPage:false})).toString('base64')}`:undefined
  let logo:string|undefined
  if(data.logoUrl)try {const r=await readPublic(data.logoUrl,200000);if(r.status===200&&/^image\/(png|jpeg|webp)/.test(r.headers['content-type']||''))logo=`data:${r.headers['content-type'].split(';')[0]};base64,${r.body.toString('base64')}`}catch{}
  return {url:page.url(),title:data.title,headings:data.headings,text:data.text,contentText:data.contentText,links:data.links,capturedAt:new Date().toISOString(),image,logo}
 } finally {await page.close()}
}
