import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { PassportModule } from '@nestjs/passport';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient } from '@prisma/client';
import { TgWarmupService } from '../tg-warmup/tg-warmup.service';
import { TgWarmupController } from '../tg-warmup/tg-warmup.controller';
import { CampaignService } from '../tg-warmup/campaign.service';
import { CampaignController } from '../tg-warmup/campaign.controller';
import { JwtStrategy } from '../auth/jwt.strategy';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../admin/admin.guard';
import { validatedDay, workspaceSnapshot } from '../tg-warmup/campaign-workspace';
import { planQueue } from '../tg-warmup/campaign-plan';
import { mskAt, mskDayKey } from '../tg-warmup/msk';
const database = process.env.CAMPAIGN_TEST_DATABASE_URL;
if (!database)
    throw new Error('CAMPAIGN_TEST_DATABASE_URL is required');
const url = new URL(database);
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.pathname.startsWith('/skyseo_callprep_'))
    throw new Error('Only a dedicated local test database is allowed');
const p = new PrismaClient({ datasources: { db: { url: database } } });
const service = Object.create(CampaignService.prototype) as any;
service.prisma = p;
const premiumService = Object.create(TgWarmupService.prototype) as any;
premiumService.prisma = p;
let canSend = true;
const denied = new Set<string>();
const allowance = { allowOutgoing: true, dailyMessages: 7, maxMessagesPerDay: 7, readiness: 80, notes: [] };
service.warmup = { claimAccount: async () => false, allowanceFor: async (a:any) => ({ ...allowance, allowOutgoing: canSend && !denied.has(a.id) }), allowancesFor: async (accounts: any[]) => new Map(accounts.map(a => [a.id, { ...allowance, allowOutgoing: canSend && !denied.has(a.id) }])) };
// No Telegram SDK connections, jobs or schedulers are constructed in this module.
service.activeHypotheses = async () => [];
service.fillLeadVars = async () => { };
const secret = 'campaign-local-test-fixture';
@Module({ imports: [PassportModule], controllers: [CampaignController,TgWarmupController], providers: [{ provide: CampaignService, useValue: service }, {provide:TgWarmupService,useValue:premiumService},
        { provide: JwtStrategy, useFactory: () => new JwtStrategy({ get: () => secret } as any, { findById: (id: string) => p.user.findUnique({ where: { id } }) } as any) }, JwtAuthGuard, AdminGuard] })
class TestModule {
}
async function main() {
    assert.equal(await p.tgCampaign.count(), 0, 'Use an empty isolated test database');
    const now = new Date(), tomorrow = mskDayKey(mskAt(now, 0, 1)), later = mskDayKey(mskAt(now, 0, 2));
    assert.throws(() => validatedDay('2026-02-30', now));
    const accounts: string[] = [], leads: string[] = [], retryHypotheses: string[] = [], retryCrm: string[] = [], prefix = randomUUID();
    const admin = await p.user.create({ data: { email: `campaign-${prefix}@example.invalid`, password: 'fixture', role: 'ADMIN', roles: ['ADMIN'], isActive: true } });
    const manager = await p.user.create({ data: { email: `campaign-manager-${prefix}@example.invalid`, password: 'fixture', role: 'MANAGER', roles: ['MANAGER'], isActive: true } });
    const proxy = await p.tgProxy.create({ data: { host: '127.0.0.1', port: 1, note: 'local-test-no-network' } });
    const app = await NestFactory.create(TestModule, { logger: false });
    app.setGlobalPrefix('v1/api');
    await app.listen(0, '127.0.0.1');
    const base = `http://127.0.0.1:${(app.getHttpServer().address() as any).port}/v1/api`, jwt = new JwtService({ secret }), token = jwt.sign({ sub: admin.id });
    const req = async (path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST', auth = token) => { const r = await fetch(base + '/admin/tg-outreach' + path, { method, headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, data: await r.json() }; };
    try {
        assert.equal((await fetch(base + '/admin/tg-outreach/workspace')).status, 401);
        assert.equal((await req('/workspace', undefined, 'GET', jwt.sign({ sub: manager.id }))).status, 403);
        const empty = await service.workspace();
        assert.equal(empty.events.length, 0);
        assert.equal(empty.totals.sent, 0);
        for (let i = 0; i < 2; i++)
            accounts.push((await p.tgAccount.create({ data: { label: `Тестовый отправитель ${i + 1}`, session: 'not-a-telegram-session', apiId: 1, apiHash: 'fixture', deviceModel: 'test', systemVersion: 'test', appVersion: 'test', langCode: 'ru', systemLangCode: 'ru', status: 'READY', mode: 'SEND', proxyId: proxy.id } })).id);
        const checkedAt=new Date(Date.now()-30*86400000), boughtAt=new Date(Date.now()-3*86400000);
        await p.tgAccount.updateMany({where:{id:{in:accounts}},data:{purchasedAt:boughtAt,probe:{premium:true},premiumCheckedAt:checkedAt}});
        premiumService.clientOptions=()=>{throw new Error('Premium tests must never connect to Telegram')};
        assert.equal(await premiumService.refreshEligibleAccounts(),0,'Do not recheck known Premium, even when confirmation is a month old');
        assert.equal(await premiumService.claimAccount(accounts[0],'send',60),true,'Atomic sender claim accepts old confirmed Premium');
        await premiumService.releaseAccount(accounts[0]);
        const premiumUrl=base+`/admin/warmup/accounts/${accounts[0]}/premium`;
        const premiumRequest=(until:unknown,auth?:string)=>fetch(premiumUrl,{method:'POST',headers:{...(auth?{Authorization:'Bearer '+auth}:{}),'Content-Type':'application/json'},body:JSON.stringify({until})});
        assert.equal((await premiumRequest('2027-01-01')).status,401);
        assert.equal((await premiumRequest('2027-01-01',jwt.sign({sub:manager.id}))).status,403);
        assert.equal((await premiumRequest('2026-02-30',token)).status,400);
        const futureDate=mskDayKey(mskAt(now,0,5));
        const saved=await premiumRequest(futureDate,token);assert.equal(saved.status,201);
        assert.equal((await saved.json()).premiumUntil,new Date(`${futureDate}T21:00:00Z`).toISOString());
        assert.equal((await p.tgAccount.findUniqueOrThrow({where:{id:accounts[0]}})).premiumCheckedAt!.getTime(),checkedAt.getTime(),'Saving a date does not forge a Telegram verification');
        assert.equal(await premiumService.claimAccount(accounts[0],'send',60),true);await premiumService.releaseAccount(accounts[0]);
        await p.tgAccount.update({where:{id:accounts[0]},data:{premiumUntil:new Date(Date.now()-1000)}});
        assert.equal(await premiumService.claimAccount(accounts[0],'send',60),false,'Expired subscription cannot claim a sender');
        await p.tgAccount.update({where:{id:accounts[0]},data:{premiumUntil:new Date(Date.now()+86400000),restrictedUntil:new Date(Date.now()+86400000)}});
        assert.equal(await premiumService.claimAccount(accounts[0],'send',60),false,'Subscription date cannot bypass Telegram restriction');
        await p.tgAccount.update({where:{id:accounts[0]},data:{premiumUntil:null,restrictedUntil:null,probe:{premium:false}}});
        assert.equal(await premiumService.claimAccount(accounts[0],'send',60),false,'Explicit negative verification remains blocked');
        await p.tgAccount.update({where:{id:accounts[0]},data:{probe:{premium:true}}});
        for (let i = 0; i < 30; i++)
            leads.push((await p.outreachLead.create({ data: { domain: `local-test-${i}.invalid`, message: '', firstName: 'Тест', telegram: `@zz_cfixture_${prefix.slice(0, 8)}_${i}`, telegramManual: true } })).id);

        const draftCampaign=await p.tgCampaign.create({data:{name:'Personal follow-up fixture',firstMessage:'Тест'}});
        const draftRecipient=await p.tgRecipient.create({data:{campaignId:draftCampaign.id,username:'zz_personal_followup',status:'REPLIED',accountId:accounts[0],sentAt:now,sentMsgId:77}});
        const personalText='Тест, добрый вечер. По запросу «стекло» сайт fixture не найден в первых 50 результатах. Удобно созвониться?';
        const draftUrl=`/recipients/${draftRecipient.id}/second-message`;
        assert.equal((await req(draftUrl,{text:personalText},'PATCH',jwt.sign({sub:manager.id}))).status,403);
        for(const text of ['fixture.ru','https://fixture.ru','Позиция {позиция}','', 'x'.repeat(4001)]) assert.equal((await req(draftUrl,{text},'PATCH')).status,400);
        assert.equal((await req(draftUrl,{text:personalText},'PATCH')).status,200);
        const savedDraft=await p.tgRecipient.findUniqueOrThrow({where:{id:draftRecipient.id},include:{campaign:true,hypothesis:true}});
        assert.equal(savedDraft.secondMessageDraft,personalText);
        assert.equal(await service.secondMessageFor(savedDraft),personalText);
        assert.equal(savedDraft.status,'REPLIED');assert.equal(savedDraft.secondSentAt,null);assert.equal(savedDraft.hypothesisId,draftRecipient.hypothesisId);
        assert.equal(await p.tgDialogMessage.count({where:{recipientId:draftRecipient.id}}),0,'Saving a prepared reply must never send or record an outgoing message');
        await p.tgRecipient.update({where:{id:draftRecipient.id},data:{deliveryUnknown:true}});
        assert.equal((await req(draftUrl,{text:personalText},'PATCH')).status,400);
        await p.tgCampaign.delete({where:{id:draftCampaign.id}});

        const draft = await service.create({name:'Old single sender'});
        assert.equal(await p.tgCampaignAccount.count({where:{campaignId:draft.id}}),2,'Empty auto campaign selects all currently permitted senders');
        await service.setAccounts(draft.id,[accounts[0]]);
        assert.equal((await p.tgCampaign.findUniqueOrThrow({where:{id:draft.id}})).autoAccounts,false);
        const legacyQuick = await service.quickFill(2,undefined,{date:tomorrow,windowFrom:0,windowTo:24,start:false});
        assert.equal(await p.tgCampaignAccount.count({where:{campaignId:legacyQuick.campaignId}}),2,'New launch never inherits the single sender of the previous campaign');
        await p.tgCampaign.delete({where:{id:legacyQuick.campaignId}});await p.tgCampaign.delete({where:{id:draft.id}});
        const norm = await service.dailyNorm(0, 24, tomorrow);
        assert.equal(norm.available, 14);
        assert.equal(norm.eligibleAccounts, 2);
        const rejected = await req('/workspace/start', { requestId: randomUUID(), date: tomorrow, count: 20, windowFrom: 0, windowTo: 24 });
        assert.equal(rejected.status, 400);
        assert.equal(await p.tgCampaign.count(), 0);
        const id = randomUUID(), body = { requestId: id, date: tomorrow, count: 20, windowFrom: 0, windowTo: 24, allowUnplanned: true };
        const concurrent = await Promise.all([req('/workspace/start', body), req('/workspace/start', body)]);
        assert.ok(concurrent.every(r => r.status === 201));
        assert.equal(await p.tgCampaign.count(), 1);
        assert.equal(await p.tgRecipient.count({ where: { campaignId: id } }), 20);
        const queued = await p.tgRecipient.findMany({ where: { campaignId: id }, orderBy: { scheduledAt: 'asc' } });
        assert.equal(queued.filter(r => r.scheduledAt).length, 14);
        assert.equal(queued.filter(r => !r.scheduledAt).length, 6);
        const reserved = await service.dailyNorm(0, 24, tomorrow);
        assert.equal(reserved.reserved, 14, 'No slot reserved on every account for one unassigned recipient');
        assert.equal(reserved.unreserved, 6);
        assert.equal(reserved.available, 0);
        const first = queued.find(r => r.scheduledAt)!, at = `${later}T12:00:00+03:00`;
        assert.equal((await req(`/recipients/${first.id}/schedule`, { at, accountId: first.plannedAccountId, expectedAt: first.scheduledAt!.toISOString() }, 'PATCH')).status, 200);
        assert.equal((await req(`/recipients/${first.id}/schedule`, { at: `${later}T13:00:00+03:00`, expectedAt: first.scheduledAt!.toISOString() }, 'PATCH')).status, 400, 'Concurrent schedule change must not overwrite a move');
        const second = queued.find(r => r.scheduledAt && r.id !== first.id && r.plannedAccountId === first.plannedAccountId)!;
        assert.equal((await req(`/recipients/${second.id}/schedule`, { at: `${later}T12:01:00+03:00` }, 'PATCH')).status, 400, 'Respect the existing min interval across the account');
        assert.equal((await req(`/recipients/${first.id}/schedule`, { at: '2020-01-01T00:00:00Z' }, 'PATCH')).status, 400);
        canSend = false;
        assert.equal((await req(`/recipients/${first.id}/schedule`, { at: `${later}T14:00:00+03:00` }, 'PATCH')).status, 400);
        canSend = true;
        await service.setStatus(id, 'PAUSED');
        assert.equal((await service.workspace(tomorrow, 0, 24)).events.filter((e: any) => e.state === 'paused').length, 13);
        await service.setStatus(id, 'RUNNING');
        assert.equal((await p.tgRecipient.findUniqueOrThrow({ where: { id: first.id } })).scheduledAt!.toISOString(), new Date(at).toISOString(), 'Resume preserves manual move');
        await p.tgRecipient.update({ where: { id: first.id }, data: { status: 'SENT', sentAt: null } });
        await p.tgAccount.update({ where: { id: first.plannedAccountId! }, data: { busyBy: 'send', busyUntil: new Date(Date.now()+60000) } });
        let snap = await service.workspace(later, 0, 24);
        assert.equal(snap.totals.sent, 0);
        assert.equal(snap.events.find((e: any) => e.id === first.id).state, 'sending');
        await p.tgRecipient.update({ where: { id: first.id }, data: { deliveryUnknown: true } });
        snap = await service.workspace(later, 0, 24);
        assert.equal(snap.events.find((e: any) => e.id === first.id).state, 'unknown');
        assert.equal((await req(`/recipients/${first.id}/schedule`, { at: `${later}T15:00:00+03:00` }, 'PATCH')).status, 400);
        await p.tgRecipient.update({ where: { id: first.id }, data: { deliveryUnknown: false, sentAt: mskAt(now, 0), readAt: now, repliedAt: now, accountId: first.plannedAccountId } });
        snap = await service.workspace(undefined, 0, 24);
        assert.equal(snap.totals.sent, 1);
        assert.equal(snap.analytics.sent, 1);
        assert.equal(snap.analytics.replied, 1);
        // Read APIs must not persist schedules or account counters.
        const before = JSON.stringify(await p.tgRecipient.findMany({ orderBy: { id: 'asc' } }));
        await service.workspace(tomorrow, 0, 24);
        assert.equal(JSON.stringify(await p.tgRecipient.findMany({ orderBy: { id: 'asc' } })), before);
        const pureCampaign = { id: 'pure', name: 'Pure', status: 'RUNNING', windowFrom: 10, windowTo: 20, minIntervalSec:240, accounts: [{ accountId: 'a', dayKey: mskDayKey(now), sentToday: 0, account: { id: 'a', status: 'READY', mode: 'SEND', proxyId: 'p', label: 'A' } }] };
        const pureR = { id: 'r', campaignId: 'pure', status: 'QUEUED', scheduledAt: mskAt(now, 12), sentAt: null, createdAt: now, plannedAccountId: 'a' };
        const ended = workspaceSnapshot([pureCampaign], [pureR], norm, new Map([['a', allowance]]), new Map([['pure', new Map([['a', 7]])]]), mskAt(now, 0), mskAt(now, 23), 7);
        assert.equal(ended.totals.planned, 0);
        assert.equal(ended.events[0].state, 'unassigned');
        const late = workspaceSnapshot([pureCampaign],Array.from({length:3},(_,i)=>({...pureR,id:`late-${i}`})),norm,new Map([['a',allowance]]),new Map([['pure',new Map([['a',7]])]]),mskAt(now,0),mskAt(now,19,0,59),7);
        assert.equal(late.totals.planned,1,'Time left must constrain the existing queue, not just new campaigns');
        assert.equal(late.events.filter((e:any)=>e.state==='unassigned').length,2);


        const lateAccount=await p.tgAccount.create({data:{label:'Late ready sender',session:'invalid-fixture',apiId:1,apiHash:'fixture',deviceModel:'test',systemVersion:'test',appVersion:'test',langCode:'ru',systemLangCode:'ru',mode:'BOTH',status:'READY',proxyId:proxy.id}});
        accounts.push(lateAccount.id);denied.add(lateAccount.id);
        const warmup=Object.create(TgWarmupService.prototype) as any;warmup.prisma=p;warmup.allowancesFor=service.warmup.allowancesFor;
        await warmup.joinActiveCampaigns([lateAccount.id]);
        await service.buildSchedule(id);
        assert.equal(await p.tgCampaignAccount.count({where:{campaignId:id,accountId:lateAccount.id}}),0,'Not-ready accounts must not be enrolled');
        denied.delete(lateAccount.id);
        const factualBefore=await p.tgRecipient.count({where:{sentAt:{not:null}}});
        await service.sendTick();
        assert.equal(await p.tgRecipient.count({where:{sentAt:{not:null}}}),factualBefore,'No Telegram sending in scheduler tests');
        assert.equal(await p.tgCampaignAccount.count({where:{campaignId:id,accountId:lateAccount.id}}),1,'Ready opt-in sender joins automatically, without toggling its mode');
        assert.ok(await p.tgRecipient.count({where:{campaignId:id,status:'QUEUED',plannedAccountId:lateAccount.id}})>0,'Newly ready sender receives its part of the queue');
        const limited={...(await p.tgCampaign.findUniqueOrThrow({where:{id},include:{accounts:{include:{account:true}}}})),dailyGoal:2};
        const todayQuota=await service.dailyQuota(limited,mskDayKey(now),{settle:false});
        assert.equal([...todayQuota.values()].reduce((n:number,v:any)=>n+v,0),2,'Already sent message counts toward the total goal after pool changes');
        const manualDraft=await service.create({name:'Manual pool test'});
        await p.tgRecipient.create({data:{campaignId:manualDraft.id,username:'zz_manual_fixture',firstName:'Тест',domain:'local.invalid'}});
        await service.setAccounts(manualDraft.id,[accounts[0]]);
        await service.setStatus(manualDraft.id,'RUNNING');
        assert.equal(await p.tgCampaignAccount.count({where:{campaignId:manualDraft.id}}),1,'Explicit manual selection must survive launch');
        await p.tgCampaign.delete({where:{id:manualDraft.id}});
        if (!process.argv.includes('--serve')) {
            const batch = await Promise.all(['A','B'].map(name=>p.tgCampaign.create({data:{name:'Parallel import '+name,firstMessage:'Здравствуйте',windowFrom:0,windowTo:24,sendDate:mskAt(now,0,3),accounts:{create:accounts.map(accountId=>({accountId}))}}})));
            const imported = await Promise.all(batch.map(c=>service.addRecipientsFromLeads(c.id,10)));
            assert.equal(imported.reduce((n,r)=>n+r.added,0),10,'Concurrent imports must not reserve the same contacts twice');
            const contacts = await p.tgRecipient.findMany({select:{username:true}});
            assert.equal(new Set(contacts.map(r=>r.username)).size,contacts.length);
        }
        if (!process.argv.includes('--serve')) {
            await p.tgCampaign.updateMany({where:{status:'RUNNING'},data:{status:'PAUSED'}});
            await p.tgAccount.updateMany({where:{id:{in:accounts}},data:{busyUntil:null,busyBy:null}});
            const fallback=await p.tgCampaign.create({data:{name:'Connection fallback',status:'RUNNING',autoAccounts:false,firstMessage:'Здравствуйте',windowFrom:0,windowTo:24,minIntervalSec:60,maxIntervalSec:60,perAccountPerDay:7,accounts:{create:accounts.slice(0,2).map((accountId,i)=>({accountId,nextSendAt:i?new Date(Date.now()+3600000):null}))}}});
            const paid=await p.tgRecipient.create({data:{campaignId:fallback.id,username:'fake_paid',status:'SENT',accountId:accounts[0],sentAt:new Date(),deliveryUnknown:true,error:'Связь оборвалась: ALLOW_PAYMENT_REQUIRED_2'}});
            const pending=await p.tgRecipient.create({data:{campaignId:fallback.id,username:'fake_fallback',status:'QUEUED',plannedAccountId:accounts[0],scheduledAt:new Date(Date.now()-60000)}});
            const calls:string[]=[];
            const originalSend=service.sendOne;
            service.warmup.claimAccount=async()=>true;
            service.warmup.releaseAccount=async()=>{};
            service.sendOne=async(_c:any,_l:any,a:any,r:any)=>{
                calls.push(a.id);
                if(a.id===accounts[0]) {
                    await p.tgRecipient.update({where:{id:r.id},data:{status:'QUEUED',sentAt:null,accountId:null,plannedAccountId:null,error:'connect ECONNREFUSED 127.0.0.1:1'}});
                    return 'failed';
                }
                await p.tgRecipient.update({where:{id:r.id},data:{status:'SENT',accountId:a.id,sentAt:new Date(),sentMsgId:1,error:null}});
                return 'sent';
            };
            try {
                assert.equal(await service.sendTick(),1,'Try an eligible sender in the same tick after a proven connection failure');
                assert.deepEqual(calls,accounts.slice(0,2));
                const repaired=await p.tgRecipient.findUniqueOrThrow({where:{id:paid.id}});
                assert.equal(repaired.status,'FAILED');
                assert.equal(repaired.sentAt,null);
                assert.equal(repaired.deliveryUnknown,false);
                assert.equal((await p.tgRecipient.findUniqueOrThrow({where:{id:pending.id}})).accountId,accounts[1]);
                await p.tgRecipient.create({data:{campaignId:fallback.id,username:'fake_restricted',status:'QUEUED',plannedAccountId:accounts[0],scheduledAt:new Date(Date.now()-60000),error:'PEER_FLOOD'}});
                await p.tgCampaignAccount.updateMany({where:{campaignId:fallback.id,accountId:accounts[0]},data:{pausedUntil:new Date(Date.now()+86400000)}});
                calls.length=0;
                assert.equal(await service.sendTick(),0,'Never move a rate-limited recipient to another sender');
                assert.deepEqual(calls,[]);
            } finally {
                service.sendOne=originalSend;
                service.warmup.claimAccount=async()=>false;
                await p.tgCampaign.delete({where:{id:fallback.id}});
            }
        }
        if (!process.argv.includes('--serve')) {
            const originalVariants=service.activeHypotheses;
            const variants=await Promise.all([
                p.tgHypothesis.create({data:{name:'Retry original fixture',text:'{фио}, {позиции}',position:9000}}),
                p.tgHypothesis.create({data:{name:'Retry compatible fixture',text:'{фио}, здравствуйте. Могу пообщаться по поводу {сайт}?',position:9001}}),
            ]);
            retryHypotheses.push(...variants.map(v=>v.id));
            service.activeHypotheses=async()=>variants;
            try {
                const baseline=await service.availableLeadCount();
                const previous=await p.tgCampaign.create({data:{name:'Unsent retry source',status:'DONE',firstMessage:'{фио}'}});
                const cases:any[]=[
                    {label:'positions'}, {label:'fixed_link',error:'ссылка или домен в тексте: отправка отменена'},
                    {label:'updated_name',firstName:null},
                    {label:'unknown',deliveryUnknown:true}, {label:'history',history:true},
                    {label:'inbound',inbound:true}, {label:'paid',error:'ALLOW_PAYMENT_REQUIRED_2'},
                    {label:'missing_name',noName:true}, {label:'restriction',error:'PEER_FLOOD'},
                    {label:'sent_at',sentAt:now}, {label:'sent_id',sentMsgId:11},
                    {label:'refused',outcome:'refused'}, {label:'blocked',blockedAt:now},
                    {label:'sender',accountId:accounts[0]}, {label:'duplicate_sent',duplicate:true},
                    {label:'stopped',status:'STOPPED'},
                ];
                const source:any[]=[];const recipientIds:string[]=[];
                for (let i=0;i<cases.length;i++) {
                    const {label,noName,history,inbound,duplicate,...patch}=cases[i];
                    const username=`zz_retry_${prefix.slice(0,8)}_${i}`;
                    const lead=await p.outreachLead.create({data:{domain:'retry-fixture.invalid',message:'',telegram:'@'+username,telegramManual:true,firstName:noName?null:'Тест'}});
                    leads.push(lead.id);
                    source.push({leadId:lead.id,username,phone:null,firstName:lead.firstName,domain:lead.domain});
                    const r=await p.tgRecipient.create({data:{campaignId:previous.id,leadId:lead.id,username,firstName:'Тест',domain:lead.domain,status:'FAILED',attempts:1,error:'не хватает данных для текста: позиции',hypothesisId:variants[0].id,...patch}});
                    recipientIds.push(r.id);
                    if(history||inbound) await p.tgDialogMessage.create({data:{recipientId:r.id,tgId:1,out:!!history,text:'fixture',date:now}});
                    if(duplicate) await p.tgRecipient.create({data:{campaignId:previous.id,username,status:'SENT',sentAt:now,sentMsgId:1}});
                }
                const crm=await p.crmLead.create({data:{title:'Retry fixture',outreachLeadId:source[0].leadId,sourceRecipientId:recipientIds[0]}});
                retryCrm.push(crm.id);
                await p.tgRecipient.update({where:{id:recipientIds[0]},data:{crmLeadId:crm.id}});
                assert.equal(await service.availableLeadCount(),baseline+3,'Only corrected, renderable pre-send failures count as available');
                const targets=await Promise.all(['A','B'].map(name=>p.tgCampaign.create({data:{name:'Retry target '+name,firstMessage:'{фио}',windowFrom:0,windowTo:24,sendDate:mskAt(now,0,1)}})));
                const imports=await Promise.all(targets.map(c=>service.insertRecipients(c.id,source,20)));
                assert.equal(imports.reduce((n,r)=>n+r.added,0),3,'Concurrent retries reserve each corrected contact once');
                for(const id of recipientIds.slice(0,3)) {
                    const row=await p.tgRecipient.findUniqueOrThrow({where:{id}});
                    assert.ok(targets.some(c=>c.id===row.campaignId));
                    assert.equal(row.status,'QUEUED');assert.equal(row.attempts,1,'Keep prior attempt count');
                    assert.equal(row.hypothesisId,variants[1].id,'Use an enabled template with available real data');
                    assert.equal(row.sentAt,null);assert.equal(row.error,null);
                }
                assert.equal((await p.crmLead.findUniqueOrThrow({where:{id:crm.id}})).sourceRecipientId,recipientIds[0]);
                assert.equal((await p.tgRecipient.findUniqueOrThrow({where:{id:recipientIds[0]}})).crmLeadId,crm.id,'Preserve CRM links and recipient identity');
                assert.equal(await service.availableLeadCount(),baseline);
                assert.equal(await p.tgRecipient.count({where:{campaignId:previous.id}}),cases.length-3+1,'Unsafe and still incomplete records stay untouched');
            } finally {service.activeHypotheses=originalVariants}
        }
        const multi = planQueue(['one','two','three'],[{id:'a',quota:2,left:0,cursor:mskAt(now,24).getTime(),floor:0,day:0,readiness:80}],{windowFrom:0,windowTo:24,minIntervalSec:240,maxIntervalSec:1200},now,{maxDays:2,reservations:[{accountId:'a',at:mskAt(now,10,1),minIntervalSec:240}]});
        assert.equal([...multi.values()].filter(v=>mskDayKey(v.at)===tomorrow).length,1,'Multiday planning must honor tomorrow reservations of another campaign');
        console.log('Campaign workspace DB/API: authorization, empty day, exact reservations, excess confirmation, concurrent idempotency, transfer persistence/conflicts, unavailable sender, pause/resume, confirmed sends, unknown delivery, period analytics and read-only polling passed.');
        if (process.argv.includes('--serve')) {
            await p.tgRecipient.updateMany({ where: { campaignId: id, status: 'QUEUED', scheduleLocked: false }, data: { scheduledAt: mskAt(now, 12) } });
            await p.tgCampaign.update({ where: { id }, data: { name: 'Тест · промышленное оборудование', windowFrom: 10, windowTo: 20 } });
            writeFileSync('/private/tmp/skyseo-campaign-local-api.json', JSON.stringify({ base, token, campaignId: id }));
            console.log('Local campaign API ready');
            await new Promise<void>(r => process.once('SIGTERM', () => r()));
        }
    }
    finally {
        await p.tgCampaign.deleteMany();
        await p.crmLead.deleteMany({where:{id:{in:retryCrm}}});
        await p.tgHypothesis.deleteMany({where:{id:{in:retryHypotheses}}});
        await p.outreachLead.deleteMany({ where: { id: { in: leads } } });
        await p.tgAccount.deleteMany({ where: { id: { in: accounts } } });
        await p.tgProxy.delete({ where: { id: proxy.id } });
        await p.user.deleteMany({ where: { id: { in: [admin.id, manager.id] } } });
        await app.close();
        await p.$disconnect();
    }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
