// Run only against a dedicated disposable database; never the production DB.
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const url = new URL(process.env.DATABASE_URL)
url.pathname = '/skyseo_workspace_test'
process.env.DATABASE_URL = url.href
const migrate = spawnSync('npx', ['prisma','migrate','deploy'], { env: process.env, encoding:'utf8' })
if (migrate.status) { console.error('Test database migration failed'); process.exit(1) }
const { PrismaClient } = require('@prisma/client')
const { WorkspaceService } = require('../dist/src/workspace/workspace.service')
const { CampaignService } = require('../dist/src/tg-warmup/campaign.service')
const { retiredProductGate } = require('../dist/src/common/retired-product')
const { TgWarmupService } = require('../dist/src/tg-warmup/tg-warmup.service')
const { AdminGuard } = require('../dist/src/admin/admin.guard')
const db = new PrismaClient()
const warmup = { setSessionPoller() {}, async allowancesFor(rows) { return new Map(rows.map(a=>[a.id,{dailyMessages:20,allowOutgoing:true}])) } }
const svc = new WorkspaceService(db,warmup)
const campaigns = new CampaignService(db,warmup,{}, {})
async function main() {
 assert.equal(new URL(process.env.DATABASE_URL).pathname, '/skyseo_workspace_test')
 await db.$executeRawUnsafe('TRUNCATE TABLE workspace_clients, workspace_settings, workspace_account_history, tg_campaigns, tg_accounts RESTART IDENTITY CASCADE')
 // Test DB contains schema only. Create five evenly allocated hypotheses.
 const c = await campaigns.create({name:'Integration test', firstMessage:'Привет'})
 const variants = Array.from({length:5},(_,i)=>({name:`V${i}`,text:`Текст ${i}`}))
 await campaigns.saveHypotheses(c.id,variants)
 const recipients = []
 for(let i=0;i<23;i++) recipients.push(await db.tgRecipient.create({data:{campaignId:c.id,username:`integration_${i}`}}))
 // Concurrent allocations prove the DB lock protects equal cohort sizes.
 await Promise.all(recipients.map(r=>campaigns.hypothesisText(c.id,r.id,'fallback')))
 let stats = await campaigns.hypotheses(c.id)
 assert.deepEqual(stats.map(v=>v.assigned).sort(),[4,4,5,5,5])
 const first = await db.tgRecipient.findUnique({where:{id:recipients[0].id}})
 await campaigns.hypothesisText(c.id,first.id,'different fallback')
 assert.equal((await db.tgRecipient.findUnique({where:{id:first.id}})).hypothesisId,first.hypothesisId)
 await assert.rejects(()=>campaigns.saveHypotheses(c.id,variants))
 const now = new Date()
 await db.tgRecipient.update({where:{id:first.id},data:{status:'REPLIED',sentAt:now,readAt:now,repliedAt:now}})
 for(let i=0;i<6;i++) await db.tgDialogMessage.create({data:{recipientId:first.id,tgId:i+1,out:false,text:'Ответ',date:now}})
 const second = recipients[1]
 await db.tgRecipient.update({where:{id:second.id},data:{status:'READ',sentAt:now,readAt:now}})
 await svc.saveSettings({dailyGoal:200,planningPerAccount:20,interestedAfter:5})
 stats = await campaigns.hypotheses(c.id)
 assert.equal(stats.reduce((s,v)=>s+v.interested,0),1)
 assert.equal(stats.reduce((s,v)=>s+v.readNoReply,0),1)
 const clientData = { name:'Тестовый клиент', telegram:'@client',website:'https://example.com',monthlyFee:10000,startsOn:'2026-08-01',status:'ACTIVE',topvisorLinks:['https://topvisor.com/project/1','https://topvisor.com/project/2'],notes:'' }
 const client = await svc.saveClient(null,clientData)
 await svc.month(client.id,'2026-08',{received:10000,expenses:2000,status:'PAID',note:''})
 await svc.month(client.id,'2026-09',{received:10000,expenses:1000,status:'PAID',note:''})
 let card=(await svc.clients()).find(x=>x.id===client.id)
 assert.equal(card.received,20000);assert.equal(card.net,17000)
 await svc.month(client.id,'2026-08',{received:10000,expenses:2000,status:'CANCELLED',note:'Возврат'})
 card=(await svc.clients()).find(x=>x.id===client.id)
 assert.equal(card.received,10000);assert.equal(card.net,7000)
 assert.equal(card.months.length,2)
 await assert.rejects(()=>svc.saveClient(client.id,{...clientData,status:'CANCELLED',cancelledOn:'2026-09-30'}))
 await svc.saveClient(client.id,{...clientData,status:'CANCELLED',cancelledOn:'2026-09-30',cancellationReason:'PRICE'})
 await assert.rejects(()=>svc.month(client.id,'2026-13',{received:100,expenses:0,status:'PAID',note:''}))
 await assert.rejects(()=>svc.month(client.id,'2026-09',{received:-1,expenses:0,status:'PAID',note:''}))
 await assert.rejects(()=>svc.saveClient(null,{...clientData,website:'javascript:alert(1)'}))
 await assert.rejects(()=>svc.saveClient(null,{...clientData,startsOn:'2026-02-31'}))
 const file=await svc.upload(client.id,{buffer:Buffer.from('test contract'),size:13,originalname:'contract.txt'})
 assert.equal((await svc.contract(file.id)).data.toString(),'test contract')
 const dashboard=await svc.dashboard(30)
 assert.equal(dashboard.interested,1);assert.equal(dashboard.readNoReply,1)
 assert.equal(dashboard.neededAccounts,10);assert.equal(dashboard.neededProxies,10)
 assert.equal(dashboard.cancelledClients,1);assert.equal(dashboard.net,7000)
 const account = await db.tgAccount.create({data:{label:'Archive test',session:'test-only',apiId:1,apiHash:'test',deviceModel:'test',systemVersion:'test',appVersion:'test',langCode:'ru',systemLangCode:'ru',createdAt:new Date(Date.now()-10*86400000)}})
 await db.tgAccountEvent.create({data:{accountId:account.id,kind:'banned',text:'test',createdAt:new Date(Date.now()-2*86400000)}})
 const warmService = new TgWarmupService(db, {})
 await warmService.deleteAccount(account.id)
 assert.equal(await db.tgAccount.count({where:{id:account.id}}),0)
 const archived=await db.workspaceAccountHistory.findUnique({where:{id:account.id}})
 assert.equal(archived.label,'Archive test');assert.ok(archived.endedAt)
 const archivedStats=await svc.dashboard(30)
 assert.equal(archivedStats.lifetimeSamples,1)
 assert.ok(Math.abs(archivedStats.averageLifetimeDays-8)<0.01)
 const guard=new AdminGuard()
 assert.throws(()=>guard.canActivate({switchToHttp:()=>({getRequest:()=>({user:{role:'USER'}})})}))
 for(const path of ['/v1/api/tasks','/v1/api/executions/start','/v1/api/auth/register','/v1/api/payments','/v1/api/admin/sites','/v1/api/updates/latest']) {
  let status
  retiredProductGate({path,method:'POST'},{status(n){status=n;return this},json(){}},()=>assert.fail('Legacy route reopened'))
  assert.equal(status,410)
 }
 for(const path of ['/v1/api/health','/v1/api/admin/workspace/clients','/v1/api/admin/warmup/accounts','/v1/api/admin/tg-outreach/campaigns','/v1/api/admin/staff','/v1/api/auth/login']) {
  let passed=false;retiredProductGate({path,method:'GET'},{},()=>{passed=true});assert.equal(passed,true)
 }
 console.log('PASS: fair concurrent variants, retry attribution, immutable tests, reply threshold, read/no reply, client ledger, monthly cancellation, validation, contracts, capacity estimates, permissions and retirement routes')
}
main().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>db.$disconnect())
