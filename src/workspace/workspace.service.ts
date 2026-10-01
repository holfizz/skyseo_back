import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { TgWarmupService } from '../tg-warmup/tg-warmup.service'
import { maySend } from '../tg-warmup/campaign.service'
import { mskDayKey } from '../tg-warmup/msk'

const reasons = ['PRICE', 'NO_RESULT', 'CLOSED', 'COMPETITOR', 'PAUSE', 'OTHER']
export function money(value: unknown) {
 const n = Number(value)
 if (value === null || value === '' || !Number.isFinite(n) || n < 0 || n > 999999999 || Math.abs(n * 100 - Math.round(n * 100)) > 0.00001) throw new BadRequestException('Сумма: положительное число, до двух знаков после запятой')
 return n
}
function date(value: string) {
 if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '') || !Number.isFinite(new Date(value).getTime()) || new Date(value).toISOString().slice(0, 10) !== value) throw new BadRequestException('Укажите корректную дату')
 return new Date(value)
}
function link(value: string) {
 try { const u = new URL(value); if (!['https:', 'http:'].includes(u.protocol)) throw 0; return u.href } catch { throw new BadRequestException('Ссылка должна начинаться с https:// или http://') }
}
@Injectable()
export class WorkspaceService {
 constructor(private db: PrismaService, private warmup: TgWarmupService) {}
 settings() { return this.db.workspaceSettings.findUnique({ where: { id: 'main' } }).then(s => s ?? { id: 'main', dailyGoal: 200, interestedAfter: 3, planningPerAccount: 20 }) }
 async saveSettings(b: any) {
  const data: any = { interestedAfter: 3 }
  for (const [k, max] of [['dailyGoal', 100000], ['planningPerAccount', 200]] as const) {
   if (!Number.isInteger(b?.[k]) || b[k] < 1 || b[k] > max) throw new BadRequestException(`Некорректное значение ${k}`)
   data[k] = b[k]
  }
  return this.db.workspaceSettings.upsert({ where: { id: 'main' }, create: { id: 'main', ...data }, update: data })
 }
 async clients() {
  const rows = await this.db.workspaceClient.findMany({ orderBy: { createdAt: 'desc' }, include: { months: { orderBy: { month: 'desc' } }, contracts: { select: { id: true, name: true, createdAt: true } } } })
  return rows.map(c => {
   const received = c.months.reduce((s, m) => s + (m.status === 'PAID' ? Number(m.received) : 0), 0)
   const expenses = c.months.reduce((s, m) => s + Number(m.expenses), 0)
   return { ...c, received, expenses, net: received - expenses }
  })
 }
 async saveClient(id: string | null, b: any) {
  if (!b || typeof b.name !== 'string' || !b.name.trim() || b.name.length > 200) throw new BadRequestException('Укажите имя клиента (до 200 символов)')
  if (!['ACTIVE', 'PAUSED', 'CANCELLED'].includes(b.status)) throw new BadRequestException('Некорректный статус')
  if (b.status === 'CANCELLED' && !reasons.includes(b.cancellationReason)) throw new BadRequestException('Выберите причину ухода')
  if (!Array.isArray(b.topvisorLinks) || b.topvisorLinks.length > 30) throw new BadRequestException('Не больше 30 ссылок')
  for (const key of ['telegram', 'website', 'notes']) if (b[key] != null && (typeof b[key] !== 'string' || b[key].length > 10000)) throw new BadRequestException('Слишком длинное поле')
  const data = { name: b.name.trim(), telegram: b.telegram?.trim() || null, website: b.website?.trim() ? link(b.website.trim()) : null, monthlyFee: money(b.monthlyFee), startsOn: date(b.startsOn), status: b.status,
   cancelledOn: b.status === 'CANCELLED' ? date(b.cancelledOn) : null, cancellationReason: b.status === 'CANCELLED' ? b.cancellationReason : null,
   topvisorLinks: b.topvisorLinks.map(link), notes: b.notes || '' }
  if (data.cancelledOn && data.cancelledOn < data.startsOn) throw new BadRequestException('Дата ухода раньше начала')
  if (id) { await this.requireClient(id); return this.db.workspaceClient.update({ where: { id }, data }) }
  return this.db.workspaceClient.create({ data })
 }
 async requireClient(id: string) {
  const c = await this.db.workspaceClient.findUnique({ where: { id } }); if (!c) throw new NotFoundException('Клиент не найден'); return c
 }
 async month(id: string, month: string, b: any) {
  await this.requireClient(id)
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new BadRequestException('Месяц: ГГГГ-ММ')
  if (!['PAID', 'PENDING', 'CANCELLED'].includes(b?.status)) throw new BadRequestException('Некорректный статус месяца')
  if (typeof b.note !== 'string' || b.note.length > 10000) throw new BadRequestException('Некорректная заметка')
  const data = { received: money(b.received), expenses: money(b.expenses), status: b.status, note: b.note }
  return this.db.workspaceMonth.upsert({ where: { clientId_month: { clientId: id, month } }, create: { clientId: id, month, ...data }, update: data })
 }
 async upload(id: string, f: Express.Multer.File) {
  await this.requireClient(id)
  if (!f || !f.buffer.length || f.size > 10 * 1024 * 1024) throw new BadRequestException('Файл договора: до 10 МБ')
  const row = await this.db.workspaceContract.create({ data: { clientId: id, name: Buffer.from(f.originalname, 'latin1').toString('utf8').replace(/[\r\n]/g, '').slice(0, 200), mime: 'application/octet-stream', data: f.buffer }, select: { id: true, name: true } })
  return row
 }
 async contract(id: string) { const f = await this.db.workspaceContract.findUnique({ where: { id } }); if (!f) throw new NotFoundException(); return f }
 async dashboard(days = 30) {
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new BadRequestException('Период от 1 до 365 дней')
  const settings = await this.settings()
  const today = new Date(`${mskDayKey(new Date())}T00:00:00+03:00`)
  const since = new Date(today.getTime() - (days - 1) * 86400000)
  const [accounts, recipients, clients, proxies] = await Promise.all([
   this.db.tgAccount.findMany({ include: { proxy: true, events: { where: { kind: { in: ['banned', 'unauthorized'] } }, orderBy: { createdAt: 'asc' }, take: 1 } } }),
   this.db.tgRecipient.findMany({ where: { sentAt: { gte: since } }, select: { id: true, accountId: true, sentAt: true, readAt: true, repliedAt: true, blockedAt: true, _count: { select: { messages: { where: { out: false } } } } } }),
   this.clients(), this.db.tgProxy.count({ where: { alive: true } }),
  ])
  const allowances = await this.warmup.allowancesFor(accounts, 0, { settle: false })
  const accountRows = await Promise.all(accounts.map(async a => {
   const allow = allowances.get(a.id)!
   const usable = !['BANNED', 'ERROR', 'PAUSED'].includes(a.status) && a.mode !== 'WARM' && (!a.proxy || a.proxy.alive) && maySend(a, allow)
   const cap = usable ? Math.min(settings.planningPerAccount, a.forceSend ? settings.planningPerAccount : allow.dailyMessages) : 0
   const rows = recipients.filter(r => r.accountId === a.id)
   const ended = a.events[0]?.createdAt
   return { id: a.id, label: a.label || a.username || a.phone || 'Аккаунт', status: a.status, proxy: !!a.proxyId, cap,
    ageDays: Math.max(0, Math.floor((Date.now() - a.createdAt.getTime()) / 86400000)), lifetimeDays: ended ? Math.max(0, (ended.getTime() - a.createdAt.getTime()) / 86400000) : null,
    sent: rows.length, sentToday: rows.filter(r => r.sentAt >= today).length, replies: rows.reduce((n, r) => n + r._count.messages, 0), interested: rows.filter(r => r._count.messages >= 3).length }
  }))
  const capacity = accountRows.reduce((s, a) => s + a.cap, 0)
  const ready = accountRows.filter(a => a.cap > 0).length
  const perAccount = ready ? capacity / ready : settings.planningPerAccount
  const needed = Math.ceil(settings.dailyGoal / perAccount)
  const archive = await this.db.workspaceAccountHistory.findMany({ orderBy: { removedAt: 'desc' } })
  const archivedLifetimes = archive.filter(a => a.endedAt).map(a => Math.max(0, (a.endedAt.getTime() - a.addedAt.getTime()) / 86400000))
  const lifetimes = accountRows.filter(a => a.lifetimeDays !== null).map(a => a.lifetimeDays!).concat(archivedLifetimes)
  const daily = Array.from({ length: days }, (_, i) => {
   const day = mskDayKey(new Date(since.getTime() + i * 86400000)); const rows = recipients.filter(r => mskDayKey(r.sentAt) === day)
   return { day, sent: rows.length, read: rows.filter(r => r.readAt).length, replied: rows.filter(r => r.repliedAt).length, interested: rows.filter(r => r._count.messages >= 3).length }
  })
  const byMonth = new Map<string, { month: string; received: number; expenses: number; net: number }>()
  for (const c of clients) for (const m of c.months) { const row = byMonth.get(m.month) || { month: m.month, received: 0, expenses: 0, net: 0 }; row.received += m.status === 'PAID' ? Number(m.received) : 0; row.expenses += Number(m.expenses); row.net = row.received - row.expenses; byMonth.set(m.month, row) }
  return { settings, days, sent: recipients.length, sentToday: recipients.filter(r => r.sentAt >= today).length,
   read: recipients.filter(r => r.readAt).length, readNoReply: recipients.filter(r => r.readAt && !r.repliedAt).length,
   replied: recipients.filter(r => r.repliedAt).length, replies: recipients.reduce((s, r) => s + r._count.messages, 0), interested: recipients.filter(r => r._count.messages >= 3).length,
   blocked: recipients.filter(r => r.blockedAt).length, capacity, ready, proxies, neededAccounts: needed, neededProxies: needed,
   additionalAccounts: Math.max(0, needed - ready), additionalProxies: Math.max(0, needed - proxies), perAccount, planningEstimate: !ready,
   remainingToday: accountRows.reduce((s, a) => s + Math.max(0, a.cap - a.sentToday), 0),
   lifetimeSamples: lifetimes.length, averageLifetimeDays: lifetimes.length ? lifetimes.reduce((s, n) => s + n, 0) / lifetimes.length : null,
   accounts: accountRows, archive, daily, finances: [...byMonth.values()].sort((a,b) => b.month.localeCompare(a.month)),
   activeClients: clients.filter(c => c.status === 'ACTIVE').length, cancelledClients: clients.filter(c => c.status === 'CANCELLED').length,
   mrr: clients.filter(c => c.status === 'ACTIVE').reduce((s,c) => s + Number(c.monthlyFee), 0), revenue: clients.reduce((s,c) => s + c.received, 0), net: clients.reduce((s,c) => s + c.net, 0) }
 }
}
