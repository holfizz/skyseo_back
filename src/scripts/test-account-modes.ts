import { strict as assert } from 'node:assert'
import { TgWarmupService } from '../tg-warmup/tg-warmup.service'

async function main() {
 const service=Object.create(TgWarmupService.prototype) as any
 let mode='BOTH',updates=0,joined=0,stopped=0
 service.prisma={tgAccount:{findUnique:async()=>({mode,status:'READY'}),update:async({data}:any)=>{mode=data.mode;updates++}},tgWarmupRun:{updateMany:async()=>{stopped++}}}
 service.joinActiveCampaigns=async()=>{joined++}
 assert.deepEqual(await service.setMode('fixture','BOTH'),{ok:true,mode:'BOTH',changed:false})
 assert.equal(updates+joined+stopped,0,'Selecting the current mode must not touch campaigns or warmup runs')
 await service.setMode('fixture','SEND');assert.equal(updates,1);assert.equal(joined,1);assert.equal(stopped,1)
 await service.setMode('fixture','SEND');assert.equal(updates,1);assert.equal(joined,1);assert.equal(stopped,1)
 console.log('Account mode idempotency and warmup preservation passed; no Telegram calls.')
}
main().catch(e=>{console.error(e);process.exitCode=1})
