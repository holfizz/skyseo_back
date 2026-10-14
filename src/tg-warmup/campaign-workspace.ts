import { BadRequestException } from '@nestjs/common';
import { mskAt, mskDayKey } from './msk';
export function validatedDay(value: string | undefined, now: Date): Date {
    if (!value)
        return mskAt(now, 0);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
        throw new BadRequestException('Выберите дату');
    const day = new Date(`${value}T00:00:00+03:00`);
    if (!Number.isFinite(day.getTime()) || mskDayKey(day) !== value)
        throw new BadRequestException('Такой даты нет');
    return day;
}
/** Stored schedule and factual timestamps only. No planning, Telegram or writes. */
export function workspaceSnapshot(campaigns: any[], recipients: any[], capacity: any, allowances: Map<string, any>, quotas: Map<string, Map<string, number>>, day: Date, now: Date, days: number) {
    if (!Number.isInteger(days) || days < 1 || days > 90)
        throw new BadRequestException('Период: от 1 до 90 дней');
    const start = day.getTime(), end = mskAt(day, 24).getTime(), today = mskDayKey(day) === mskDayKey(now);
    const inDay = (at: Date | null) => !!at && at.getTime() >= start && at.getTime() < end;
    const active = new Set(campaigns.filter(c => ['RUNNING', 'PAUSED'].includes(c.status)).map(c => c.id));
    const byCampaign = new Map(campaigns.map(c => [c.id, c]));
    const globalLeft = new Map([...allowances].map(([id, a]) => [id, today ? a.maxMessagesPerDay : a.dailyMessages]));
    const campaignLeft = new Map<string, number>();
    const cursors = new Map<string, number>();
    const queued = recipients.filter(r => r.status === 'QUEUED' && active.has(r.campaignId));
    const events: any[] = [];
    for (const r of recipients.filter(r => inDay(r.sentAt) || (!r.sentAt && inDay(r.scheduledAt) && byCampaign.get(r.campaignId)?.status !== 'DONE')).sort((a, b) => (a.sentAt ?? a.scheduledAt).getTime() - (b.sentAt ?? b.scheduledAt).getTime())) {
        const c = byCampaign.get(r.campaignId)!;
        const id = r.sentAt ? r.accountId : r.plannedAccountId;
        const link = c.accounts.find((l: any) => l.accountId === id);
        const allow = allowances.get(id);
        const quota = quotas.get(c.id)?.get(id) ?? 0;
        const key = `${c.id}:${id}`;
        if (!campaignLeft.has(key))
            campaignLeft.set(key, Math.max(0, quota - (today && link?.dayKey === mskDayKey(day) ? link.sentToday : 0)));
        let state = r.sentAt ? 'sent' : r.deliveryUnknown ? 'unknown' : r.status === 'SENT' ? (link?.account.busyBy === 'send' && link.account.busyUntil > now ? 'sending' : 'unknown') : ['FAILED', 'BLOCKED'].includes(r.status) ? 'error' : r.status === 'STOPPED' ? 'canceled' : c.status === 'DRAFT' ? 'draft' : c.status !== 'RUNNING' ? 'paused' : 'planned';
        let reason: string | null = null;
        const earliest = Math.max(r.scheduledAt?.getTime() ?? start, today ? now.getTime() : start, mskAt(day,c.windowFrom).getTime(), link?.nextSendAt?.getTime() ?? 0, link?.pausedUntil?.getTime() ?? 0, link?.account.busyUntil?.getTime() ?? 0, cursors.get(id) ?? 0);
        if (state === 'planned') {
            if (!link || !allow?.allowOutgoing || ['BANNED', 'ERROR', 'PAUSED'].includes(link.account.status) || link.account.mode === 'WARM' || !link.account.proxyId)
                reason = allow?.notes?.[0] || 'Аккаунт недоступен';
            else if (r.scheduledAt < mskAt(day, c.windowFrom) || r.scheduledAt >= mskAt(day, c.windowTo))
                reason = 'Время вне окна рассылки';
            else if ((globalLeft.get(id) ?? 0) <= 0 || (campaignLeft.get(key) ?? 0) <= 0)
                reason = 'Дневная норма занята';
            else if (earliest >= mskAt(day,c.windowTo).getTime())
                reason = 'Недостаточно времени до конца окна';
            if (reason)
                state = 'unassigned';
            else {
                globalLeft.set(id, (globalLeft.get(id) ?? 0) - 1);
                campaignLeft.set(key, (campaignLeft.get(key) ?? 0) - 1);
                cursors.set(id, earliest + Math.max(30,c.minIntervalSec)*1000);
            }
        }
        events.push({ id: r.id, campaignId: c.id, campaignName: c.name, campaignStatus: c.status,
            at: state === 'planned' ? new Date(earliest) : r.sentAt ?? r.scheduledAt, scheduledAt: r.scheduledAt, state, reason,
            accountId: id, accountLabel: link?.account.label || link?.account.tgUserId || 'Не назначен',
            name: [r.firstName, r.middleName].filter(Boolean).join(' ') || r.username || 'Контакт',
            status: r.status, readAt: r.readAt, repliedAt: r.repliedAt, error: r.error,
            movable: r.status === 'QUEUED' && !r.sentAt && !r.deliveryUnknown });
    }
    const noSlot = queued.filter(r => !r.scheduledAt || !r.plannedAccountId || r.scheduledAt.getTime() < start);
    const sent = recipients.filter(r => inDay(r.sentAt)).length;
    const planned = events.filter(e => e.state === 'planned').length;
    const pending = events.filter(e => ['unassigned', 'paused', 'unknown', 'sending'].includes(e.state)).length;
    const deferred = noSlot.length + pending + queued.filter(r => r.scheduledAt && r.scheduledAt.getTime() >= end).length;
    const next = events.filter(e => e.state === 'planned').map(e => ({ ...e, effectiveAt: new Date(Math.max(e.at.getTime(), today ? now.getTime() : start, mskAt(day, byCampaign.get(e.campaignId)!.windowFrom).getTime(), byCampaign.get(e.campaignId)!.accounts.find((l: any) => l.accountId === e.accountId)?.nextSendAt?.getTime() ?? 0, byCampaign.get(e.campaignId)!.accounts.find((l: any) => l.accountId === e.accountId)?.pausedUntil?.getTime() ?? 0, byCampaign.get(e.campaignId)!.accounts.find((l: any) => l.accountId === e.accountId)?.account.busyUntil?.getTime() ?? 0)) })).sort((a, b) => a.effectiveAt.getTime() - b.effectiveAt.getTime())[0];
    const since = mskAt(now, 0, -(days - 1)), until = mskAt(now, 24);
    const within = (at: Date | null) => !!at && at >= since && at < until;
    const daily = Array.from({ length: days }, (_, i) => ({ date: mskDayKey(mskAt(since, 0, i)), sent: 0, read: 0, replied: 0 }));
    for (const r of recipients)
        for (const [field, at] of [['sent', r.sentAt], ['read', r.readAt], ['replied', r.repliedAt]] as const) {
            if (within(at)) {
                const cell = daily.find(d => d.date === mskDayKey(at));
                if (cell)
                    cell[field as 'sent' | 'read' | 'replied']++;
            }
        }
    const summary = campaigns.map(c => {
        const rows = recipients.filter(r => r.campaignId === c.id), cohort = rows.filter(r => within(r.sentAt));
        return { id: c.id, name: c.name, status: c.status, windowFrom: c.windowFrom, windowTo: c.windowTo, accounts: c.accounts.length,
            total: rows.length, sent: rows.filter(r => r.sentAt).length, queued: rows.filter(r => r.status === 'QUEUED').length,
            errors: rows.filter(r => ['FAILED', 'BLOCKED'].includes(r.status) || r.deliveryUnknown || (r.status === 'SENT' && !r.sentAt)).length,
            planned: events.filter(e => e.campaignId === c.id && e.state === 'planned').length,
            todaySent: rows.filter(r => inDay(r.sentAt)).length,
            unassigned: rows.filter(r => r.status === 'QUEUED' && (!r.scheduledAt || !r.plannedAccountId)).length,
            periodSent: cohort.length, periodRead: cohort.filter(r => r.readAt).length, periodReplies: cohort.filter(r => r.repliedAt).length,
            periodErrors: rows.filter(r => within(r.createdAt) && ['FAILED', 'BLOCKED'].includes(r.status)).length,
            periodCanceled: rows.filter(r => within(r.createdAt) && r.status === 'STOPPED').length,
            nextAt: next?.campaignId === c.id ? next.effectiveAt : events.filter(e => e.campaignId === c.id && e.state === 'planned')[0]?.at ?? null };
    });
    return { date: mskDayKey(day), now, capacity, totals: { sent, planned, available: capacity.available, deferred }, nextAt: next?.effectiveAt ?? null,
        events, noSlot: noSlot.map(r => ({ id: r.id, campaignId: r.campaignId, campaignName: byCampaign.get(r.campaignId)!.name, name: r.firstName || r.username || 'Контакт' })),
        campaigns: summary, analytics: { days, daily, campaigns: summary,
            sent: summary.reduce((n, c) => n + c.periodSent, 0), read: summary.reduce((n, c) => n + c.periodRead, 0), replied: summary.reduce((n, c) => n + c.periodReplies, 0),
            errors: summary.reduce((n, c) => n + c.periodErrors, 0), canceled: summary.reduce((n, c) => n + c.periodCanceled, 0) } };
}
