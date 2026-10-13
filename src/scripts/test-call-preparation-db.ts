import 'reflect-metadata'
import {strict as assert} from 'node:assert'
import {readFileSync,writeFileSync,existsSync} from 'node:fs'
import {randomUUID} from 'node:crypto'
import {Module,ValidationPipe} from '@nestjs/common'
import {NestFactory} from '@nestjs/core'
import {PassportModule} from '@nestjs/passport'
import {ConfigService} from '@nestjs/config'
import {JwtService} from '@nestjs/jwt'
import {PrismaClient} from '@prisma/client'
import {PrismaService} from '../prisma/prisma.service'
import {WorkspaceCrmController} from '../crm/workspace-crm.controller'
import {CrmService} from '../crm/crm.service'
import {FollowUpService} from '../crm/follow-up.service'
import {QualificationService} from '../crm/qualification.service'
import {CallPreparationService} from '../crm/preparation/preparation.service'
import {ReportService} from '../report/report.service'
import {JwtStrategy} from '../auth/jwt.strategy'
import {JwtAuthGuard} from '../auth/jwt-auth.guard'
import {SprintGuard} from '../sprint/sprint.guard'
import {UsersService} from '../users/users.service'
import {fixtureResearch} from './test-call-preparation'
import {buildSlideOutline} from '../report/call-presentation.template'
const database=process.env.CALL_PREPARATION_TEST_DATABASE_URL
if(!database)throw new Error('Set CALL_PREPARATION_TEST_DATABASE_URL to an isolated local test database')
const parsed=new URL(database)
if(!['127.0.0.1','localhost'].includes(parsed.hostname)||!parsed.pathname.startsWith('/skyseo_callprep_'))throw new Error('Only a dedicated local skyseo_callprep_* test database is allowed')
const prisma=new PrismaClient({datasources:{db:{url:database}}})
const secret='local-call-preparation-test-fixture-secret'
const report=new ReportService(prisma as any),preparation=new CallPreparationService(prisma as any,report)
preparation.onModuleInit=()=>{} // No research jobs or other schedulers run during API contract tests.
@Module({imports:[PassportModule],controllers:[WorkspaceCrmController],providers:[
 {provide:PrismaService,useValue:prisma},{provide:CrmService,useValue:new CrmService(prisma as any,null as any)},
 {provide:FollowUpService,useValue:new FollowUpService(prisma as any)},{provide:QualificationService,useValue:new QualificationService(prisma as any)},
 {provide:ReportService,useValue:report},{provide:CallPreparationService,useValue:preparation},
 {provide:ConfigService,useValue:new ConfigService({JWT_SECRET:secret})},
 {provide:UsersService,useValue:{findById:(id:string)=>prisma.user.findUnique({where:{id}})}},
 {provide:JwtStrategy,useFactory:()=>new JwtStrategy({get:(key:string)=>key==='JWT_SECRET'?secret:undefined} as any,{findById:(id:string)=>prisma.user.findUnique({where:{id}})} as any)},JwtAuthGuard,SprintGuard,
]})class TestModule{}
async function main(){
 const prefix=randomUUID(),admin=await prisma.user.create({data:{email:`callprep-${prefix}@example.invalid`,password:'test-only',role:'ADMIN',roles:['ADMIN'],isActive:true}}),employee=await prisma.user.create({data:{email:`callprep-employee-${prefix}@example.invalid`,password:'test-only',role:'MANAGER',roles:['MANAGER'],isActive:true}})
 const jwt=new JwtService({secret}),token=jwt.sign({sub:admin.id}),otherToken=jwt.sign({sub:employee.id})
 const app=await NestFactory.create(TestModule,{logger:false});app.setGlobalPrefix('v1/api');app.useGlobalPipes(new ValidationPipe({transform:true,whitelist:true,forbidNonWhitelisted:true}));await app.listen(0,'127.0.0.1')
 const port=(app.getHttpServer().address() as any).port,base=`http://127.0.0.1:${port}/v1/api`
 const req=async(path:string,body?:unknown,method=body===undefined?'GET':'POST',authorization=token)=>{
  const r=await fetch(base+path,{method,headers:{Authorization:`Bearer ${authorization}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const text=await r.text();let data:any;try{data=JSON.parse(text)}catch{data=text};return {status:r.status,data}
 }
 let leadId='',outreachId=''
 try{
  const me=await req('/workspace/crm/me');assert.equal(me.status,200)
  const outreach=await prisma.outreachLead.create({data:{domain:'skb-4.com',companyName:'СКБ-4',firstName:'Дмитрий',city:'Москва',message:''}});outreachId=outreach.id
  const lead=await prisma.crmLead.create({data:{title:'СКБ-4',contact:'@local_test_contact',outreachLeadId:outreach.id,assigneeId:me.data.id,createdById:me.data.id,qualification:{seoGoal:'Исходная задача'}}});leadId=lead.id
  const path=`/workspace/crm/leads/${lead.id}`
  assert.equal((await fetch(base+path+'/preparation')).status,401)
  for(const suffix of ['/preparation','/call-script','/preparation/pdf/client','/preparation/slides/1'])assert.equal((await req(path+suffix,undefined,'GET',otherToken)).status,403,suffix)
  assert.equal((await req(path+'/preparation',{website:'http://127.0.0.1',refresh:true})).status,400)
  const simultaneous=await Promise.all([req(path+'/preparation',{region:'Москва'}),req(path+'/preparation',{region:'Москва'}),req(path+'/preparation',{region:'Москва'})]);assert.ok(simultaneous.every(r=>r.status===201));assert.equal(new Set(simultaneous.map(r=>r.data.id)).size,1)
  assert.equal(await prisma.crmCallPreparation.count({where:{leadId:lead.id}}),1)
  await req(path,{qualification:{callCaseComment:'Сохраняем кейс',callStepId:'case',callQuestionKey:'',callPreparationVersion:1}},'PATCH')
  await Promise.all([req(path,{qualification:{callPortfolioComment:'Портфолио'}},'PATCH'),req(path,{qualification:{callPotentialComment:'Потенциал'}},'PATCH')])
  const saved=await prisma.crmLead.findUniqueOrThrow({where:{id:lead.id}});assert.equal((saved.qualification as any).seoGoal,'Исходная задача');assert.equal((saved.qualification as any).callCaseComment,'Сохраняем кейс');assert.equal((saved.qualification as any).callPortfolioComment,'Портфолио');assert.equal((saved.qualification as any).callPotentialComment,'Потенциал')
  const taskId=randomUUID(),date=new Date(Date.now()+7*86400000).toISOString()
  assert.equal((await req(path+'/follow-up',{taskId,dueAt:date,note:'Обсудить тест'})).status,201)
  const follow=await prisma.crmTask.findUniqueOrThrow({where:{id:taskId},include:{reminders:true}});assert.equal(follow.kind,'FOLLOW_UP');assert.equal(follow.dueAt?.toISOString(),date);assert.ok(follow.reminders.length>0)
  const research=fixtureResearch(),outline=buildSlideOutline(research)
  await prisma.crmCallPreparation.update({where:{leadId:lead.id},data:{status:'FAILED',phase:'DOCUMENTS',research:research as any,slideOutline:outline as any,clientPdf:Buffer.from('%PDF-test-checkpoint')}})
  const retry=await req(path+'/preparation',{retryPhase:'DOCUMENTS'});assert.equal(retry.status,201)
  const resumed=await prisma.crmCallPreparation.findUniqueOrThrow({where:{leadId:lead.id}});assert.ok(resumed.clientPdf?.length);assert.equal((resumed.research as any).sitePages.length,1);assert.equal((resumed.research as any).keywords[0].position,3)
  const workers=[new CallPreparationService(prisma as any,report),new CallPreparationService(prisma as any,report)];let runs=0
  for(const worker of workers)(worker as any).run=async(id:string,version:number)=>{runs++;await new Promise(r=>setTimeout(r,40));await prisma.crmCallPreparation.updateMany({where:{id,version,status:'RUNNING'},data:{status:'PARTIAL',phase:'DOCUMENTS',slideOutline:outline as any,research:research as any,clientPdf:Buffer.from('%PDF-test-client'),scriptPdf:Buffer.from('%PDF-test-script'),generatedAt:new Date(),leaseUntil:null}})}
  await Promise.all(workers.map(w=>w.tick()));assert.equal(runs,1,'One lease must prevent two processes from generating the same job')
  const context=await req(path+'/call-script');assert.equal(context.status,200);assert.equal(context.data.preparation.ready,true);assert.equal(context.data.progress.stepId,'case');assert.equal(context.data.script.steps.find((s:any)=>s.id==='case').slides[0],outline.findIndex(s=>s.kind==='CASE')+1)
  assert.equal((await req(path+'/call-script?recipientId='+randomUUID())).status,404)
  assert.equal((await req(path+'/preparation/slides/999')).status,404)
  assert.equal((await req(path+'/preparation/slides/1')).status,200)
  assert.equal((await req(path+'/preparation/pdf/client')).status,200)
  if(process.argv.includes('--serve')){
   const folder='docs/clients/skb-4/prepared-call-2026-10-13',source=existsSync(folder+'/research.json')?JSON.parse(readFileSync(folder+'/research.json','utf8')).research:research
   const slides=buildSlideOutline(source)
   await prisma.crmLead.update({where:{id:lead.id},data:{qualification:{},budgetComment:null,decisionMaker:null}})
   await prisma.crmCallPreparation.update({where:{leadId:lead.id},data:{research:source as any,slideOutline:slides as any,status:'PARTIAL',phase:'DOCUMENTS',clientPdf:existsSync(folder+'/CLIENT_PRESENTATION.pdf')?readFileSync(folder+'/CLIENT_PRESENTATION.pdf'):Buffer.from('%PDF-fixture'),scriptPdf:existsSync(folder+'/CALL_SCRIPT.pdf')?readFileSync(folder+'/CALL_SCRIPT.pdf'):Buffer.from('%PDF-fixture'),generatedAt:new Date()}})
   writeFileSync('/private/tmp/skyseo-call-local-api.json',JSON.stringify({base,port,token,leadId:lead.id}))
   console.log(JSON.stringify({api:base,leadId:lead.id,mode:'isolated local browser verification'}))
   await new Promise<void>(resolve=>process.once('SIGTERM',()=>resolve()))
  }else console.log('Preparation DB/API: migration, authorization, idempotent start, concurrent qualification merge, persistent cursor, CrmTask/reminder, preserved checkpoint and cross-worker lease passed.')
 }finally{
  if(leadId){await prisma.crmTask.deleteMany({where:{leadId}});await prisma.crmLead.delete({where:{id:leadId}})};if(outreachId)await prisma.outreachLead.delete({where:{id:outreachId}})
  assert.equal(await prisma.crmCallPreparation.count({where:{leadId}}),0,'Preparation must cascade when the local test lead is deleted')
  await prisma.crmActivity.deleteMany({where:{actor:{userId:{in:[admin.id,employee.id]}}}})
  await prisma.crmUser.deleteMany({where:{userId:{in:[admin.id,employee.id]}}});await prisma.user.deleteMany({where:{id:{in:[admin.id,employee.id]}}});await app.close();await prisma.$disconnect()
 }
}
main().catch(e=>{console.error(e);process.exitCode=1})
