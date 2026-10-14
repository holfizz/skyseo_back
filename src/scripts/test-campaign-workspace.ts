import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { PassportModule } from '@nestjs/passport';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient } from '@prisma/client';
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
let canSend = true;
const allowance = { allowOutgoing: true, dailyMessages: 7, maxMessagesPerDay: 7, readiness: 80, notes: [] };
service.warmup = { allowanceFor: async () => ({ ...allowance, allowOutgoing: canSend }), allowancesFor: async (accounts: any[]) => new Map(accounts.map(a => [a.id, { ...allowance, allowOutgoing: canSend }])) };
// No Telegram SDK connections, jobs or schedulers are constructed in this module.
service.activeHypotheses = async () => [];
service.fillLeadVars = async () => { };
const secret = 'campaign-local-test-fixture';
@Module({ imports: [PassportModule], controllers: [CampaignController], providers: [{ provide: CampaignService, useValue: service },
        { provide: JwtStrategy, useFactory: () => new JwtStrategy({ get: () => secret } as any, { findById: (id: string) => p.user.findUnique({ where: { id } }) } as any) }, JwtAuthGuard, AdminGuard] })
class TestModule {
}
async function main() {
    assert.equal(await p.tgCampaign.count(), 0, 'Use an empty isolated test database');
    const now = new Date(), tomorrow = mskDayKey(mskAt(now, 0, 1)), later = mskDayKey(mskAt(now, 0, 2));
    assert.throws(() => validatedDay('2026-02-30', now));
    const accounts: string[] = [], leads: string[] = [], prefix = randomUUID();
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
        for (let i = 0; i < 30; i++)
            leads.push((await p.outreachLead.create({ data: { domain: `local-test-${i}.invalid`, message: '', firstName: 'Тест', telegram: `@zz_cfixture_${prefix.slice(0, 8)}_${i}`, telegramManual: true } })).id);
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
        if (!process.argv.includes('--serve')) {
            const batch = await Promise.all(['A','B'].map(name=>p.tgCampaign.create({data:{name:'Parallel import '+name,firstMessage:'Здравствуйте',windowFrom:0,windowTo:24,sendDate:mskAt(now,0,3),accounts:{create:accounts.map(accountId=>({accountId}))}}})));
            const imported = await Promise.all(batch.map(c=>service.addRecipientsFromLeads(c.id,10)));
            assert.equal(imported.reduce((n,r)=>n+r.added,0),10,'Concurrent imports must not reserve the same contacts twice');
            const contacts = await p.tgRecipient.findMany({select:{username:true}});
            assert.equal(new Set(contacts.map(r=>r.username)).size,contacts.length);
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
        await p.outreachLead.deleteMany({ where: { id: { in: leads } } });
        await p.tgAccount.deleteMany({ where: { id: { in: accounts } } });
        await p.tgProxy.delete({ where: { id: proxy.id } });
        await p.user.deleteMany({ where: { id: { in: [admin.id, manager.id] } } });
        await app.close();
        await p.$disconnect();
    }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
