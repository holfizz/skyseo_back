import { strict as assert } from 'node:assert';
import { CampaignService } from '../tg-warmup/campaign.service';

async function check(recipient: any, history: boolean, allowed: boolean) {
    const service = Object.create(CampaignService.prototype) as any;
    let claimed=0;
    service.prisma={
        tgRecipient:{findUnique:async()=>({id:'r',account:{id:'a',status:'READY'},...recipient})},
        tgDialogMessage:{findFirst:async({where}:any)=>{
            assert.equal(where.recipientId,'r');assert.equal(where.out,true);assert.deepEqual(where.tgId,{gt:0});
            return history ? {id:'outgoing'} : null;
        }},
    };
    service.warmup={claimAccount:async()=>{claimed++;return false},busyReason:async()=> 'test: account busy'};
    await assert.rejects(service.sendManual('r','Вот ссылка: https://skyseo.site/cases'),
        (e:any)=>allowed ? e.message==='test: account busy' : e.message.includes('В первом сообщении ссылки запрещены'));
    assert.equal(claimed,allowed?1:0,'No network or account claim before link permission is verified');
}

async function main() {
    await check({status:'QUEUED',sentAt:null,sentMsgId:null,deliveryUnknown:false},false,false);
    await check({status:'SENT',sentAt:new Date(),sentMsgId:null,deliveryUnknown:false},false,false);
    await check({status:'SENT',sentAt:new Date(),sentMsgId:1,deliveryUnknown:true},true,false);
    await check({status:'REPLIED',sentAt:null,sentMsgId:null,deliveryUnknown:false},false,false);
    await check({status:'SENT',sentAt:new Date(),sentMsgId:1,deliveryUnknown:false},false,true);
    await check({status:'REPLIED',sentAt:null,sentMsgId:null,deliveryUnknown:false},true,true);
    console.log('Manual links: first message/incoming-only/unknown delivery blocked; confirmed outgoing and synchronized outgoing history allowed. No Telegram requests.');
}
main().catch(e=>{console.error(e);process.exitCode=1});
