import { strict as assert } from 'node:assert';
import * as transport from '../tg-warmup/tg-client';
import { CampaignService } from '../tg-warmup/campaign.service';
import { workspaceSnapshot } from '../tg-warmup/campaign-workspace';
import { mskAt } from '../tg-warmup/msk';
import { reusableUnsentRecipient } from '../tg-warmup/campaign-delivery';
import { SECOND_MESSAGE } from '../tg-warmup/campaign-preset';

// Exercise the real sendOne catch branches with a fake Telegram transport.
// No sessions, Telegram requests or database connections.
async function attempt(phase: 'connect' | 'send', message: string) {
    const changes: any[] = [], pauses: any[] = [];
    const original = transport.withClient;
    (transport as any).withClient = async (_: any, fn: any) => {
        if (phase === 'connect') throw new Error(message);
        return fn({sendMessage: async () => {throw new Error(message)}});
    };
    const s = Object.create(CampaignService.prototype) as any;
    s.prisma = {
        tgRecipient: {findFirst:async()=>null,update:async(x:any)=>{changes.push(x.data);return x.data}},
        tgAccount:{updateMany:async()=>({count:1})},
    };
    s.logger = {warn:()=>{}};
    s.stopReason = async()=>null;
    s.hypothesisText = async()=> 'Здравствуйте';
    s.resolvePeer = async()=>({entity:'fake',userId:'1'});
    s.warmup = {clientOptions:()=>({}),applyFailure:async()=>{}};
    s.pauseAccount = async(...args:any[])=>pauses.push(args);
    s.notifyAdmin = async()=>{};
    try {
        const verdict = await s.sendOne({id:'c',name:'test',firstMessage:'Здравствуйте'}, {id:'l'}, {id:'a'}, {id:'r',username:'fake',scheduleLocked:false});
        return {verdict,row:changes.at(-1),pauses};
    } finally {(transport as any).withClient=original}
}

async function main() {
    const previews = Object.create(CampaignService.prototype) as any;
    const reply = {firstName:'Тест',domain:'fixture.ru',leadVars:{конкуренты:'rival.ru'},hypothesis:{hasSecondMessage:true,secondMessage:'Сайт {сайт}: {позиции}. Выше {конкуренты}.'}};
    assert.equal(await previews.secondMessageFor(reply),SECOND_MESSAGE,'Missing positions must leave an available call invitation, without invented ranks');
    assert.equal(await previews.secondMessageFor({...reply,leadVars:{...reply.leadVars,позиции:'«запрос»: 15 место'}}),'Сайт fixture: «запрос»: 15 место. Выше rival.','Complete personalized follow-up stays unchanged and strips domain suffixes');
    assert.equal(await previews.secondMessageFor({...reply,hypothesis:{hasSecondMessage:false,secondMessage:'disabled'}}),null,'Respect disabled second messages');
    assert.equal(await previews.secondMessageFor({...reply,hypothesis:{hasSecondMessage:true,secondMessage:'https://fixture.ru'}}),null,'Prepared replies must not use manual link permission');
    const unsent = { status:'FAILED', error:'не хватает данных для текста: позиции', campaign:{status:'DONE'}, _count:{messages:0} };
    assert.equal(reusableUnsentRecipient(unsent),true);
    for (const patch of [{deliveryUnknown:true},{sentAt:new Date()},{sentMsgId:1},{sentMsgId:0},{accountId:'a'},
        {readAt:new Date()},{repliedAt:new Date()},{secondSentAt:new Date()},{blockedAt:new Date()},
        {outcome:'refused'},{_count:{messages:1}},{status:'STOPPED'},
        {error:'номер записан неверно'},{error:'ALLOW_PAYMENT_REQUIRED_2'},
        {error:'PEER_FLOOD'},{error:'FLOOD_WAIT_100'},{error:'ECONNRESET'},{error:null}]) {
        assert.equal(reusableUnsentRecipient({...unsent,...patch}),false,JSON.stringify(patch));
    }
    assert.equal(reusableUnsentRecipient({...unsent,status:'QUEUED',error:null}),true);
    assert.equal(reusableUnsentRecipient({...unsent,status:'QUEUED',error:null,campaign:{status:'RUNNING'}}),false);
    assert.equal(reusableUnsentRecipient({...unsent,status:'QUEUED',error:'PEER_FLOOD'}),false);
    for(const message of ['ALLOW_PAYMENT_REQUIRED_2','USERNAME_NOT_OCCUPIED','USER_PRIVACY_RESTRICTED']) {
        const r=await attempt('send',message);
        assert.equal(r.verdict,'skipped');
        assert.equal(r.row.sentAt,null);
        assert.equal(r.row.deliveryUnknown,false);
        assert.equal(r.pauses.length,0,'Recipient rejection must not pause the sender');
    }
    const network=await attempt('connect','connect ECONNREFUSED 127.0.0.1:1');
    assert.equal(network.row.status,'QUEUED');
    assert.equal(network.row.plannedAccountId,null,'Known unsent connection failure becomes available to another sender');
    const unknown=await attempt('send','ECONNRESET');
    assert.equal(unknown.row.deliveryUnknown,true);
    assert.equal(unknown.row.status,'SENT','Unknown delivery never returns to the queue');
    for(const message of ['PEER_FLOOD','FLOOD_WAIT_100']) {
        const r=await attempt('send',message);
        assert.equal(r.row.status,'QUEUED');
        assert.equal(r.row.sentAt,null);
        assert.notEqual(r.row.plannedAccountId,null,'Telegram restriction must not rotate sender');
    }
    const now=new Date(), day=mskAt(now,0);
    const c={id:'c',name:'test',status:'RUNNING',windowFrom:0,windowTo:24,minIntervalSec:60,accounts:[]};
    const base={campaignId:'c',status:'SENT',scheduledAt:now,sentAt:now,createdAt:now};
    const snapshot=workspaceSnapshot([c],[{...base,id:'ok',deliveryUnknown:false},{...base,id:'unknown',deliveryUnknown:true,error:'ECONNRESET'},{...base,id:'paid',deliveryUnknown:true,error:'Связь оборвалась: ALLOW_PAYMENT_REQUIRED_2'},{...base,id:'missing',status:'FAILED',sentAt:null,error:'Контакт не найден в Telegram'}],{available:0},new Map(),new Map(),day,now,7);
    assert.equal(snapshot.totals.sent,1);
    assert.equal(snapshot.analytics.sent,1);
    assert.equal(snapshot.events.find(e=>e.id==='unknown').state,'unknown');
    assert.equal(snapshot.events.find(e=>e.id==='paid').state,'error');
    assert.equal(snapshot.events.find(e=>e.id==='missing').state,'error');
    assert.ok(snapshot.campaigns[0].reasons.includes('Контакт принимает только платные сообщения. Отправка отменена'));
    console.log('Campaign delivery: recipient rejections, connection fallback, uncertain delivery, restriction binding and factual counters passed');
}
main().catch(e=>{console.error(e);process.exitCode=1});
