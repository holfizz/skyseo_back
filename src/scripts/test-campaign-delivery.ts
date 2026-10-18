import { strict as assert } from 'node:assert';
import * as transport from '../tg-warmup/tg-client';
import { CampaignService } from '../tg-warmup/campaign.service';
import { workspaceSnapshot } from '../tg-warmup/campaign-workspace';
import { mskAt } from '../tg-warmup/msk';
import { reusableUnsentRecipient } from '../tg-warmup/campaign-delivery';
import { containsDomainOrUrl } from '../common/domain';
import { followUpKeywords, personalFollowUp } from '../tg-warmup/personal-followup';

// Exercise the real sendOne catch branches with a fake Telegram transport.
// No sessions, Telegram requests or database connections.
async function attempt(phase: 'connect' | 'send', message: string, gender = 'MALE', template = 'Здравствуйте') {
    const changes: any[] = [], pauses: any[] = [], outgoing: string[] = [];
    const original = transport.withClient;
    const originalRandom = Math.random;
    (transport as any).withClient = async (_: any, fn: any) => {
        if (phase === 'connect') throw new Error(message);
        return fn({sendMessage: async (_peer:any, body:any) => {outgoing.push(body.message);throw new Error(message)}});
    };
    const s = Object.create(CampaignService.prototype) as any;
    s.prisma = {
        tgRecipient: {findFirst:async()=>null,update:async(x:any)=>{changes.push(x.data);return x.data}},
        tgAccount:{findUnique:async()=>({gender}),updateMany:async()=>({count:1})},
    };
    s.logger = {warn:()=>{}};
    s.stopReason = async()=>null;
    s.hypothesisText = async()=> template;
    s.resolvePeer = async()=>({entity:'fake',userId:'1'});
    s.warmup = {clientOptions:()=>({}),applyFailure:async()=>{}};
    s.pauseAccount = async(...args:any[])=>pauses.push(args);
    s.notifyAdmin = async()=>{};
    try {
        // Inspect the complete outgoing text, not the random pre-edit draft.
        Math.random = () => 0.99;
        const verdict = await s.sendOne({id:'c',name:'test',firstMessage:'Здравствуйте'}, {id:'l'}, {id:'a'}, {id:'r',username:'fake',scheduleLocked:false});
        return {verdict,row:changes.at(-1),pauses,outgoing};
    } finally {(transport as any).withClient=original;Math.random=originalRandom}
}

async function main() {
    const previews = Object.create(CampaignService.prototype) as any;
    const reply = {account:{gender:'MALE'},leadId:'lead',firstName:'Тест',domain:'fixture.ru',leadVars:{конкуренты:'wrong.ru'},hypothesis:{hasSecondMessage:true,secondMessage:'Сайт {сайт}: {позиции}. Выше {конкуренты}.'}};
    previews.prisma={
        outreachLead:{findUnique:async()=>({domain:'fixture.ru',importId:'import',import:{region:'Москва',createdAt:new Date('2026-08-30T12:00:00Z')}})},
        serpRow:{findMany:async({where}:any)=>where.domain ? [{keyword:'стекло',position:6},{keyword:'стекло',position:28}] : [{keyword:'стекло',position:6,domain:'fixture.ru'},{keyword:'стекло',position:3,domain:'higher.ru'},{keyword:'стекло',position:10,domain:'lower.ru'}]},
    };
    const personal='Тест, добрый вечер. По запросу «стекло» сайт fixture не найден в первых 50 результатах. Удобно созвониться?';
    assert.equal(await previews.secondMessageFor({...reply,secondMessageDraft:personal}),personal,'Keep the approved personal draft');
    assert.equal(await previews.secondMessageFor({...reply,secondMessageDraft:'Посмотрите fixture.ru'}),null,'Prepared text cannot bypass the link guard');
    const generated=await previews.secondMessageFor(reply);
    assert.match(await previews.secondMessageFor({...reply,account:{gender:'FEMALE'}}),/Посмотрела сайт/);
    assert.equal(await previews.secondMessageFor({...reply,account:{gender:'UNSPECIFIED'}}),null);
    assert.match(generated,/«стекло» вы на 6 месте/,'Top-10 data must not disappear');
    assert.match(generated,/Посмотрел сайт в Яндексе:/,'Use the approved outreach wording');
    assert.doesNotMatch(generated,/сохраненн|сохранено|30\.08\.2026|Москва/,'Import metadata must not be presented as a measurement date');
    assert.ok(generated.includes('higher')&&!generated.includes('lower')&&!generated.includes('wrong'),'Only use competitors actually above the selected keyword');
    assert.ok(!generated.includes('28 месте'),'Use the best URL rank for each keyword');
    assert.equal(containsDomainOrUrl(generated),false);
    assert.equal(await previews.secondMessageFor({...reply,leadId:null}),null,'No generic fallback when real keyword data is missing');
    assert.equal(await previews.secondMessageFor({...reply,domain:'another.ru'}),null,'Never use another website data');
    assert.equal(await previews.secondMessageFor({...reply,hypothesis:{hasSecondMessage:false}}),generated,'Manual personalized continuation is shared across all first-message hypotheses');
    assert.deepEqual(followUpKeywords([{keyword:'best',position:1},{keyword:'growth',position:25},{keyword:'growth',position:15},{keyword:'bad',position:0}]),[{keyword:'growth',position:15},{keyword:'best',position:1}]);
    assert.equal(personalFollowUp({domain:'fixture.ru',keywords:[],competitors:[]}),null);
    const topOne=personalFollowUp({domain:'fixture.ru',keywords:[{keyword:'стекло',position:1}],competitors:[]})!;
    assert.ok(topOne.includes('1 месте')&&!topOne.includes('выше'),'Do not invent competitors above the first place');
    previews.prisma.serpRow.findMany=async({where}:any)=>where.domain
        ? [{keyword:'рост',position:15},{keyword:'стекло',position:6}]
        : [{keyword:'рост',position:10,domain:'first-rival.ru'},{keyword:'стекло',position:5,domain:'unrelated-rival.ru'}];
    const multi=await previews.secondMessageFor(reply);
    assert.ok(multi.includes('По «рост» выше вас first-rival')&&!multi.includes('unrelated-rival'),'Competitor evidence must match the query named in the comparison');
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
    const femaleSend=await attempt('send','USERNAME_NOT_OCCUPIED','FEMALE','Смотрел сайт, нашел возможности. Могу показать, что нашёл.');
    assert.deepEqual(femaleSend.outgoing,['Смотрела сайт, нашла возможности. Могу показать, что нашла.']);
    const unconfigured=await attempt('send','ECONNRESET','UNSPECIFIED','Смотрел сайт.');
    assert.deepEqual(unconfigured.outgoing,[]);assert.equal(unconfigured.row.status,'QUEUED');assert.equal(unconfigured.row.sentAt,null);
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
