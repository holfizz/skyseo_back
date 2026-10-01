const assert = require('node:assert/strict')
const { CampaignService } = require('../dist/src/tg-warmup/campaign.service')
const RealDate = Date
const instant = new RealDate('2026-10-01T08:00:00Z')
global.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : [instant])) } static now() { return +instant } }
const accounts = ['a','b','c','d','e','blocked'].map(id => ({id, status:'READY', mode:'SEND', proxyId:'proxy'}))
const allowances = new Map(accounts.map(a => [a.id,{dailyMessages:a.id==='blocked'?0:['d','e'].includes(a.id)?15:500,maxMessagesPerDay:a.id==='blocked'?0:['d','e'].includes(a.id)?15:500,allowOutgoing:a.id!=='blocked'}]))
let pending = []
const prisma = {
 tgAccount: {findMany:async()=>accounts},
 tgCampaign: {findFirst:async()=>({perAccountPerDay:20,minIntervalSec:240})},
 tgRecipient: {findMany:async()=>pending},
 $transaction:async fn=>fn({$executeRaw:async()=>1}),
}
const service = new CampaignService(prisma,{allowancesFor:async()=>allowances,setSessionPoller:()=>{}})
;(async()=>{
 let r = await service.dailyNorm(10,20)
 assert.deepEqual(r.groups,[{limit:20,accounts:3},{limit:15,accounts:2}])
 assert.equal(r.dailyTotal,90);assert.equal(r.available,90)
 // Already sent in other campaigns and active queues share the allowance.
 allowances.get('a').maxMessagesPerDay=493
 pending = Array.from({length:4},()=>({plannedAccountId:'a',campaign:{accounts:[]}}))
 r=await service.dailyNorm(10,20);assert.equal(r.sent,7);assert.equal(r.reserved,4);assert.equal(r.available,79)
 // Exhausted account stays visible in the formula but cannot send again.
 allowances.set('d',{dailyMessages:15,maxMessagesPerDay:0,allowOutgoing:false})
 r=await service.dailyNorm(10,20);assert.equal(r.dailyTotal,90);assert.equal(r.available,64);assert.equal(r.sent,22)
 r=await service.dailyNorm(0,1);assert.equal(r.available,0)
 await assert.rejects(()=>service.dailyNorm(20,10))
 let launched
 service.quickFill=async(n,id,opts)=>{launched={n,opts};return {added:n}}
 await service.startDailyNorm(10,20)
 assert.equal(launched.n,64);assert.equal(launched.opts.norm.rows.find(r=>r.id==='a').available,9)
 await assert.rejects(()=>service.startDailyNorm(0,1))
 // Exercise the actual creation path: fresh campaign, exact per-account remainder.
 delete service.quickFill
 let created
 prisma.tgCampaignAccount={findMany:async()=>[]}
 prisma.tgCampaign.create=async({data})=>{created=data;return {id:'new',...data}}
 prisma.tgCampaign.update=async()=>({})
 prisma.tgRecipient.count=async()=>64
 service.addRecipientsFromLeads=async(id,n)=>({added:n})
 service.setStatus=async()=>({schedule:[]})
 service.buildSchedule=async()=>({planned:64,capacity:64})
 service.bottleneck=async()=>null
 const createdResult=await service.startDailyNorm(10,20)
 assert.equal(createdResult.added,64)
 assert.equal(created.name,'Норма · 2026-10-01')
 assert.deepEqual(created.accounts.create,[{accountId:'a',dailyLimit:9},{accountId:'b',dailyLimit:20},{accountId:'c',dailyLimit:20},{accountId:'e',dailyLimit:15}])
 console.log('PASS mixed quotas, global spending, reservations, exhausted/blocked accounts, closed window, fresh launch calculation')
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{global.Date=RealDate})
