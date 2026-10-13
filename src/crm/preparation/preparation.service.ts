import { Injectable, BadRequestException, NotFoundException, OnModuleInit, OnModuleDestroy } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { PrismaService } from '../../prisma/prisma.service'
import { resolveRegion, hostOf } from '../../common/yandex-positions'
import { PHASES, Research, PreparationPhase, DeckSlide } from './types'
import { PrepareCallDto } from './dto'
import { publicUrl } from './public-web'
import { runPreparation } from './pipeline'
import { ReportService } from '../../report/report.service'
const json=(value:unknown)=>JSON.parse(JSON.stringify(value))
@Injectable()
export class CallPreparationService implements OnModuleInit,OnModuleDestroy {
 private working=false;private timer?:ReturnType<typeof setInterval>
 constructor(private readonly prisma:PrismaService, private readonly report:ReportService){}
 onModuleInit(){this.timer=setInterval(()=>void this.tick().catch(()=>{}),5000);this.timer.unref();setTimeout(()=>void this.tick().catch(()=>{}),1000).unref()}
 onModuleDestroy(){if(this.timer)clearInterval(this.timer)}
 async context(leadId:string,recipientId?:string){
  const lead=await this.prisma.crmLead.findUnique({where:{id:leadId},include:{outreachLead:true,client:true,sourceRecipient:{include:{account:{select:{label:true,username:true}}}},tasks:{where:{kind:'FOLLOW_UP',status:{not:'DONE'}},orderBy:{dueAt:'asc'}}}})
  if(!lead)throw new NotFoundException('Лид не найден')
  const origin=recipientId?await this.prisma.tgRecipient.findFirst({where:{id:recipientId,crmLeadId:leadId},include:{account:{select:{label:true,username:true}}}}):lead.sourceRecipient
  if(recipientId&&!origin)throw new NotFoundException('Диалог не относится к этому CRM-лиду')
  const follow=lead.tasks.find(t=>t.followUpRecipientId===(recipientId||origin?.id||null))
  return {...(lead.outreachLead||{}),...(origin||{}),id:recipientId||origin?.id,company:lead.outreachLead?.companyName||lead.client?.company||lead.title,domain:lead.outreachLead?.domain||lead.client?.website,crmLead:lead,followUpTask:follow||null}
 }
 async get(leadId:string){
  const row=await this.prisma.crmCallPreparation.findUnique({where:{leadId},select:{id:true,leadId:true,status:true,phase:true,version:true,research:true,slideOutline:true,error:true,generatedAt:true,updatedAt:true}})
  if(!row)return null
  const research=row.research as unknown as Research
  return {...row,research:undefined,completed:research.completed,issues:research.issues,domain:research.domain,region:research.region,trial:research.trial,keywordCount:research.keywords.length,checkedCount:research.keywords.filter(k=>k.measuredAt&&!k.error).length,competitorCount:research.comparisons.length,ready:row.status==='READY'||row.status==='PARTIAL'}
 }
 async start(leadId:string,dto:PrepareCallDto){
  const context=await this.context(leadId)
  return this.prisma.$transaction(async tx=>{
   await tx.$queryRaw`SELECT id FROM crm_leads WHERE id=${leadId} FOR UPDATE`
   const previous=await tx.crmCallPreparation.findUnique({where:{leadId}})
   if(previous&&['PENDING','RUNNING'].includes(previous.status)&&(!previous.leaseUntil||previous.leaseUntil>new Date()))return {id:previous.id,status:previous.status,version:previous.version}
   if(previous&&!dto.refresh&&['READY','PARTIAL'].includes(previous.status)&&!dto.retryPhase)return {id:previous.id,status:previous.status,version:previous.version}
   let research:Research
   if(previous&&!dto.refresh){
    research=previous.research as unknown as Research
    const retry=dto.retryPhase as PreparationPhase||previous.phase as PreparationPhase
    research.completed=research.completed.filter(p=>PHASES.indexOf(p)<PHASES.indexOf(retry))
    research.issues=research.issues.filter(i=>PHASES.indexOf(i.phase)<PHASES.indexOf(retry))
    if(retry==='SITE')research.sitePages=[]
    if(retry==='SITE'){research.keywords=[];research.comparisons=[]}
    else if(PHASES.indexOf(retry)<=2)research.comparisons=[]
   }else{
    const website=dto.website||context.domain
    if(!website)throw new BadRequestException('Укажите сайт клиента')
    let u:URL
    try {u=publicUrl(website)} catch(error) {throw new BadRequestException(error instanceof Error?error.message:'Некорректный сайт')}
    const region=resolveRegion(dto.region||context.crmLead.outreachLead?.city||undefined)
    if(/не распознан/.test(region.city))throw new BadRequestException('Укажите поддерживаемый город или числовой код региона Яндекса')
    research={version:1,domain:hostOf(u.href),siteUrl:u.origin,companyName:context.company,region:{name:region.city,lr:region.lr,assumed:!dto.region&&!context.crmLead.outreachLead?.city},sitePages:[],keywords:[],comparisons:[],issues:[],completed:[],trial:dto.trial||'UNCONFIRMED',createdAt:new Date().toISOString()}
   }
   // The limit is persisted with the checkpoint so a restart cannot expand a job.
   const payload={...research,maxKeywords:dto.maxKeywords||(previous?.research as any)?.maxKeywords||40}
   const documentsOnly=!!previous&&!dto.refresh&&(dto.retryPhase||previous.phase)==='DOCUMENTS'
   const data={status:'PENDING',phase:research.completed.length?PHASES[research.completed.length]||'DOCUMENTS':'SITE',research:json(payload),error:null,leaseUntil:null,slideOutline:documentsOnly?previous.slideOutline:null,clientPdf:documentsOnly?previous.clientPdf:null,scriptPdf:documentsOnly?previous.scriptPdf:null,generatedAt:null}
   const row=previous?await tx.crmCallPreparation.update({where:{id:previous.id},data:{...data,version:{increment:1}}}):await tx.crmCallPreparation.create({data:{...data,id:randomUUID(),leadId}})
   return {id:row.id,status:row.status,version:row.version}
  })
 }
 async prepared(leadId:string){return this.prisma.crmCallPreparation.findUnique({where:{leadId}})}
 private async checkpoint(id:string,version:number,research:Research,extra:Record<string,unknown>={}){
  const result=await this.prisma.crmCallPreparation.updateMany({where:{id,version,status:'RUNNING'},data:{research:json(research),leaseUntil:new Date(Date.now()+15*60*1000),...extra}})
  if(!result.count)throw new Error('Подготовка изменена другим процессом')
 }
 async tick(){
  if(this.working)return
  this.working=true
  try{
   const now=new Date();const pending=await this.prisma.crmCallPreparation.findFirst({where:{OR:[{status:'PENDING'},{status:'RUNNING',leaseUntil:{lt:now}}]},orderBy:{createdAt:'asc'}})
   if(!pending)return
   const claim=await this.prisma.crmCallPreparation.updateMany({where:{id:pending.id,version:pending.version,OR:[{status:'PENDING'},{status:'RUNNING',leaseUntil:{lt:now}}]},data:{status:'RUNNING',leaseUntil:new Date(Date.now()+15*60*1000)}})
   if(!claim.count)return
   await this.run(pending.id,pending.version,pending.leadId,pending.research as unknown as Research)
  }finally{this.working=false}
 }
 private async run(id:string,version:number,leadId:string,research:Research){
  try{
  const context=await this.context(leadId)
  const keywords=context.crmLead.outreachLeadId?(await this.report.leadBrief(context.crmLead.outreachLeadId))?.keywords.map(k=>k.keyword)||[]:[]
  await runPreparation(research,context,{save:(r,phase,extra={})=>this.checkpoint(id,version,r,{phase,...extra,...extra.slideOutline?{slideOutline:json(extra.slideOutline)}:{}}),clientPdf:async()=>{const row=await this.prepared(leadId);return row?.clientPdf||null}},keywords)
  }catch{await this.checkpoint(id,version,research,{status:'FAILED',error:'Не удалось загрузить данные клиента. Материалы сохранены',leaseUntil:null})}
 }
}
