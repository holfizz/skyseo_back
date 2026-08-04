/**
 * Демо-данные CRM для разработки: воронка, клиенты, лиды, сделки, задачи, тарифы.
 * Ничего не удаляет и безопасен к повторному запуску — у всех записей фиксированные
 * id с префиксом `seed-`, поэтому второй прогон обновляет их, а не плодит дубли.
 * Удалить потом: DELETE FROM ... WHERE id LIKE 'seed-%'.
 *
 * Usage: npm run seed:crm   (только dev-БД)
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const DAY = 24 * 60 * 60 * 1000
const at = (days: number, hour = 12) => {
	const d = new Date(Date.now() + days * DAY)
	d.setHours(hour, 0, 0, 0)
	return d
}

async function main() {
	const dbUrl = process.env.DATABASE_URL ?? ''
	if (!dbUrl.includes('skyseo_dev') && !dbUrl.includes('localhost')) {
		console.error('❌ Отказ: DATABASE_URL не похож на dev-базу. Прод не трогаем.')
		process.exit(1)
	}

	// ── Сотрудники ───────────────────────────────────────────────────────────
	// Профиль CrmUser создаётся при первом входе. Для сида заводим его заранее всем,
	// у кого есть рабочая роль, — иначе некому назначать задачи и сделки.
	const staff = await prisma.user.findMany({
		where: { OR: [{ role: { in: ['ADMIN', 'MANAGER', 'SMM'] } }, { roles: { hasSome: ['ADMIN', 'MANAGER', 'SMM'] } }] },
		select: { id: true, email: true, role: true, roles: true },
	})
	const members: { id: string; email: string }[] = []
	for (const s of staff) {
		const isAdmin = s.role === 'ADMIN' || s.roles.includes('ADMIN')
		const m = await prisma.crmUser.upsert({
			where: { userId: s.id },
			create: { userId: s.id, email: s.email, firstName: s.email.split('@')[0], role: isAdmin ? 'ADMIN' : 'EMPLOYEE' },
			update: { email: s.email, role: isAdmin ? 'ADMIN' : 'EMPLOYEE' },
		})
		members.push({ id: m.id, email: s.email })
	}
	if (members.length === 0) {
		console.error('❌ В базе нет сотрудников (ADMIN/MANAGER/SMM) — некому назначать задачи.')
		process.exit(1)
	}
	// Раскидываем ответственных по кругу, чтобы доски не выглядели «всё на одном».
	const who = (i: number) => members[i % members.length].id
	console.log(`👥 Сотрудников в CRM: ${members.length}`)

	// ── Тарифы ───────────────────────────────────────────────────────────────
	const tariffs = [
		{ id: 'seed-tariff-start', name: 'Старт', points: 5000, price: 4900, position: 0, description: 'Пробное продвижение: 1 сайт, до 10 ключей.' },
		{ id: 'seed-tariff-pro', name: 'Продвижение', points: 20000, price: 17900, position: 1, description: 'Основной тариф: до 3 сайтов, 50 ключей, отчёты по позициям.' },
		{ id: 'seed-tariff-max', name: 'Максимум', points: 60000, price: 49900, position: 2, description: 'Для агентств: без лимита по сайтам, приоритет в стакане.' },
	]
	for (const t of tariffs) {
		await prisma.tariff.upsert({ where: { id: t.id }, create: t, update: t })
	}
	console.log(`💰 Тарифов: ${tariffs.length}`)

	// ── Воронка ──────────────────────────────────────────────────────────────
	await prisma.crmFunnel.upsert({
		where: { id: 'seed-funnel' },
		create: { id: 'seed-funnel', name: 'Продажи', color: '#a0b5ff', position: 0 },
		update: { name: 'Продажи', color: '#a0b5ff' },
	})
	const stages = [
		{ id: 'seed-stage-new', title: 'Заявка', color: '#a0b5ff', position: 0 },
		{ id: 'seed-stage-contact', title: 'Связались', color: '#7fd1c8', position: 1 },
		{ id: 'seed-stage-offer', title: 'Отправили КП', color: '#ffe381', position: 2 },
		{ id: 'seed-stage-pay', title: 'Ждём оплату', color: '#ffb27f', position: 3 },
		{ id: 'seed-stage-won', title: 'Оплатили', color: '#8fd88f', position: 4 },
	]
	for (const s of stages) {
		await prisma.crmFunnelStage.upsert({
			where: { id: s.id },
			create: { ...s, funnelId: 'seed-funnel' },
			update: { title: s.title, color: s.color, position: s.position },
		})
	}

	// ── Клиенты ──────────────────────────────────────────────────────────────
	const clients = [
		{ id: 'seed-client-1', title: 'Ромашка, интернет-магазин', company: 'ООО «Ромашка»', email: 'zakaz@romashka.ru', phone: '+7 900 111-22-33', website: 'romashka.ru', status: 'ACTIVE' as const, stageId: 'seed-stage-won', notes: 'Платят второй месяц. Хотят добавить второй сайт.' },
		{ id: 'seed-client-2', title: 'Сфера Легал', company: 'Сфера Легал', email: 'info@sfera-legal.ru', phone: '+7 900 222-33-44', website: 'sfera-legal.ru', status: 'NEGOTIATION' as const, stageId: 'seed-stage-pay', notes: 'Согласовали «Продвижение», ждём счёт от бухгалтерии.' },
		{ id: 'seed-client-3', title: 'Иван Петров', email: 'ivan.petrov@mail.ru', telegram: '@ivpetrov', status: 'NEGOTIATION' as const, stageId: 'seed-stage-offer', notes: 'Частник, свой сайт по ремонту. Торгуется.' },
		{ id: 'seed-client-4', title: 'Мастерская окон', company: 'ИП Кузнецов', phone: '+7 900 444-55-66', website: 'okna-master.ru', status: 'LEAD' as const, stageId: 'seed-stage-contact', notes: 'Написали в ТГ, договорились созвониться.' },
		{ id: 'seed-client-5', title: 'Клиника «Здоровье»', company: 'ООО «Здоровье»', email: 'sale@zdorovie.clinic', website: 'zdorovie.clinic', status: 'LEAD' as const, stageId: 'seed-stage-new', notes: 'Заявка с сайта, ещё не разбирали.' },
		{ id: 'seed-client-6', title: 'Автосервис 24', company: 'ИП Смирнов', phone: '+7 900 666-77-88', website: 'avto24.ru', status: 'CHURNED' as const, stageId: 'seed-stage-offer', notes: 'Ушёл: не устроила скорость роста позиций.' },
	]
	for (const [i, c] of clients.entries()) {
		const data = { ...c, funnelId: 'seed-funnel', assigneeId: who(i), createdById: members[0].id }
		await prisma.crmClient.upsert({ where: { id: c.id }, create: data, update: data })
	}
	console.log(`🏢 Клиентов: ${clients.length}`)

	// ── Лиды ─────────────────────────────────────────────────────────────────
	const leads = [
		{ id: 'seed-lead-1', title: 'Пекарня «Хлебная»', contact: '+7 901 100-10-10', source: 'SITE_FORM' as const, status: 'NEW' as const, comment: 'Заявка с формы: «хотим в топ по доставке хлеба».' },
		{ id: 'seed-lead-2', title: 'Студия маникюра Nails', contact: '@nails_studio', source: 'TELEGRAM' as const, status: 'NEW' as const, comment: 'Написали в бота ночью.' },
		{ id: 'seed-lead-3', title: 'Юрист Соколов', contact: 'sokolov@lawyer.ru', source: 'OUTREACH' as const, status: 'IN_WORK' as const, comment: 'Ответил на рассылку, просит кейсы.' },
		{ id: 'seed-lead-4', title: 'Мастерская окон', contact: '+7 900 444-55-66', source: 'REFERRAL' as const, status: 'QUALIFIED' as const, comment: 'Пришёл по рекомендации Ромашки.', clientId: 'seed-client-4' },
		{ id: 'seed-lead-5', title: 'Магазин запчастей', contact: 'parts@shop.ru', source: 'SITE_FORM' as const, status: 'REJECTED' as const, comment: 'Хотели гарантию топ-1 за неделю.', rejectReason: 'Нереалистичные ожидания' },
		{ id: 'seed-lead-6', title: 'Барбершоп Bro', contact: '@bro_barber', source: 'MANUAL' as const, status: 'IN_WORK' as const, comment: 'Завели руками после выставки.' },
	]
	for (const [i, l] of leads.entries()) {
		const data = { ...l, assigneeId: l.status === 'NEW' ? null : who(i), createdById: members[0].id }
		await prisma.crmLead.upsert({ where: { id: l.id }, create: data, update: data })
	}
	console.log(`📥 Лидов: ${leads.length}`)

	// ── Сделки ───────────────────────────────────────────────────────────────
	const deals = [
		{ id: 'seed-deal-1', clientId: 'seed-client-1', title: 'Ромашка — Максимум', amount: 49900, tariffId: 'seed-tariff-max', stageId: 'seed-stage-won', probability: 100, status: 'WON' as const, position: 0 },
		{ id: 'seed-deal-2', clientId: 'seed-client-1', title: 'Ромашка — второй сайт', amount: 17900, tariffId: 'seed-tariff-pro', stageId: 'seed-stage-offer', probability: 60, status: 'OPEN' as const, position: 0, expectedCloseAt: at(9) },
		{ id: 'seed-deal-3', clientId: 'seed-client-2', title: 'Сфера Легал — Продвижение', amount: 17900, tariffId: 'seed-tariff-pro', stageId: 'seed-stage-pay', probability: 85, status: 'OPEN' as const, position: 0, expectedCloseAt: at(3) },
		{ id: 'seed-deal-4', clientId: 'seed-client-3', title: 'Петров — Старт', amount: 4900, tariffId: 'seed-tariff-start', stageId: 'seed-stage-offer', probability: 40, status: 'OPEN' as const, position: 1, expectedCloseAt: at(14) },
		{ id: 'seed-deal-5', clientId: 'seed-client-4', title: 'Мастерская окон — Старт', amount: 4900, tariffId: 'seed-tariff-start', stageId: 'seed-stage-contact', probability: 30, status: 'OPEN' as const, position: 0, expectedCloseAt: at(21) },
		{ id: 'seed-deal-6', clientId: 'seed-client-5', title: 'Клиника — на оценке', amount: 17900, stageId: 'seed-stage-new', probability: 15, status: 'OPEN' as const, position: 0, expectedCloseAt: at(30) },
		{ id: 'seed-deal-7', clientId: 'seed-client-6', title: 'Автосервис — продление', amount: 17900, tariffId: 'seed-tariff-pro', stageId: 'seed-stage-offer', probability: 0, status: 'LOST' as const, position: 2, lostReason: 'Не устроила скорость роста' },
	]
	for (const [i, d] of deals.entries()) {
		const data = { ...d, funnelId: 'seed-funnel', assigneeId: who(i), createdById: members[0].id }
		await prisma.crmDeal.upsert({ where: { id: d.id }, create: data, update: data })
	}
	console.log(`🤝 Сделок: ${deals.length}`)

	// ── Задачи ───────────────────────────────────────────────────────────────
	const tasks = [
		{ id: 'seed-task-1', title: 'Позвонить в клинику «Здоровье»', description: 'Разобрать заявку с сайта, снять запрос.', status: 'TODO' as const, priority: 2, clientId: 'seed-client-5', dueAt: at(-1, 15), position: 0 },
		{ id: 'seed-task-2', title: 'Выставить счёт Сфере Легал', description: 'Тариф «Продвижение», 17 900 ₽.', status: 'IN_PROGRESS' as const, priority: 1, clientId: 'seed-client-2', dueAt: at(1, 11), position: 0 },
		{ id: 'seed-task-3', title: 'Собрать семантику для Ромашки', description: 'Второй сайт, ~40 ключей.', status: 'IN_PROGRESS' as const, priority: 0, clientId: 'seed-client-1', dueAt: at(2, 18), position: 1 },
		{ id: 'seed-task-4', title: 'Отправить кейсы юристу Соколову', status: 'TODO' as const, priority: 1, dueAt: at(0, 17), position: 1 },
		{ id: 'seed-task-5', title: 'Созвон с мастерской окон', description: 'Договорились на утро.', status: 'TODO' as const, priority: 0, clientId: 'seed-client-4', dueAt: at(3, 10), position: 2 },
		{ id: 'seed-task-6', title: 'Подготовить КП для Петрова', status: 'TODO' as const, priority: 0, clientId: 'seed-client-3', dueAt: at(4, 14), position: 3 },
		{ id: 'seed-task-7', title: 'Написать пост про рост позиций', description: 'Кейс Ромашки: топ-10 за месяц.', status: 'DRAFT' as const, priority: 0, dueAt: at(7, 12), position: 0 },
		{ id: 'seed-task-8', title: 'Обзвонить брошенные оплаты', description: 'Список PENDING за последнюю неделю.', status: 'DRAFT' as const, priority: 1, dueAt: at(5, 16), position: 1 },
		{ id: 'seed-task-9', title: 'Завести Ромашку в системе', status: 'DONE' as const, priority: 0, clientId: 'seed-client-1', dueAt: at(-5, 12), position: 0, completedAt: at(-5, 13) },
		{ id: 'seed-task-10', title: 'Разобрать отказ автосервиса', description: 'Зафиксировать причину для аналитики.', status: 'DONE' as const, priority: 0, clientId: 'seed-client-6', dueAt: at(-3, 12), position: 1, completedAt: at(-3, 15) },
	]
	for (const [i, t] of tasks.entries()) {
		const data = { ...t, assigneeId: who(i), createdById: members[0].id }
		await prisma.crmTask.upsert({ where: { id: t.id }, create: data, update: data })
	}
	console.log(`✅ Задач: ${tasks.length}`)

	// Напоминания — только на будущие дедлайны, иначе шедулер отправит их сразу.
	const reminders = [
		{ id: 'seed-rem-1', taskId: 'seed-task-2', offsetLabel: 'за 1 час', remindAt: new Date(at(1, 11).getTime() - 60 * 60 * 1000) },
		{ id: 'seed-rem-2', taskId: 'seed-task-5', offsetLabel: 'за 1 день', remindAt: new Date(at(3, 10).getTime() - DAY) },
	]
	for (const r of reminders) {
		await prisma.crmReminder.upsert({ where: { id: r.id }, create: r, update: r })
	}

	console.log('\n🎉 CRM наполнена. Открывай http://localhost:3001/crm')
}

main()
	.catch(e => {
		console.error(e)
		process.exit(1)
	})
	.finally(() => prisma.$disconnect())
