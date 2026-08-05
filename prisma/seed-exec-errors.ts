/**
 * Демо-выполнения для проверки журнала: ошибки + случай «не ушли дальше 1-й страницы».
 * Нужен, чтобы увидеть в админке красный бейдж «только 1 стр.», KPI и пометку
 * в истории баланса, не дожидаясь реальных выполнений с боевых ПК.
 *
 * Ничего не удаляет, безопасен к повторному запуску: id с префиксом `seed-exec-`.
 * Удалить потом: DELETE FROM executions WHERE id LIKE 'seed-exec-%';
 *
 * Usage: npm run seed:exec-errors [userId]     (только dev-БД)
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const DEFAULT_USER = 'aea1b568-47c4-449f-8d38-8dc66edd4d34'
const minutesAgo = (m: number) => new Date(Date.now() - m * 60 * 1000)

async function main() {
	const dbUrl = process.env.DATABASE_URL ?? ''
	if (!dbUrl.includes('skyseo_dev') && !dbUrl.includes('localhost')) {
		console.error('❌ Отказ: DATABASE_URL не похож на dev-базу. Прод не трогаем.')
		process.exit(1)
	}

	const userId = process.argv[2] || DEFAULT_USER
	const site = await prisma.website.findFirst({
		where: { userId },
		include: { tasks: { where: { keyword: { not: null } }, take: 6, orderBy: { createdAt: 'asc' } } },
	})
	if (!site || site.tasks.length === 0) {
		console.error(`❌ У пользователя ${userId} нет сайта с ключевиками.`)
		process.exit(1)
	}

	// Исполнителем ставим кого-то другого — свой же сайт крутить нельзя,
	// и в журнале хочется видеть реальную пару «владелец ↔ исполнитель».
	const executor = await prisma.user.findFirst({
		where: { id: { not: userId }, isActive: true },
		select: { id: true, email: true },
	})
	if (!executor) {
		console.error('❌ Не нашёл второго пользователя под роль исполнителя.')
		process.exit(1)
	}

	console.log(`🎯 сайт: ${site.url} (${site.tasks.length} ключей)`)
	console.log(`👤 исполнитель: ${executor.email}`)

	const t = (i: number) => site.tasks[i % site.tasks.length]

	// Каждый сценарий — отдельная строка в журнале задач.
	const rows = [
		{
			id: 'seed-exec-stuck-1',
			task: t(0),
			status: 'COMPLETED' as const,
			failureReason: null,
			foundInTop: false,
			minutes: 12,
			// Главный случай: выдачу открыли, но дальше первой страницы не ушли.
			scan: { found: false, maxPage: 5, pagesParsed: 1, totalResults: 10 },
		},
		{
			id: 'seed-exec-stuck-2',
			task: t(1),
			status: 'COMPLETED' as const,
			failureReason: null,
			foundInTop: false,
			minutes: 34,
			scan: { found: false, maxPage: 3, pagesParsed: 1, totalResults: 12 },
		},
		{
			id: 'seed-exec-notfound-deep',
			task: t(2),
			status: 'COMPLETED' as const,
			failureReason: null,
			foundInTop: false,
			minutes: 56,
			// Для контраста: листали честно все 5 страниц и всё равно не нашли —
			// бейдж «только 1 стр.» здесь появляться НЕ должен.
			scan: { found: false, maxPage: 5, pagesParsed: 5, totalResults: 48 },
		},
		{
			id: 'seed-exec-script-error',
			task: t(3),
			status: 'FAILED' as const,
			failureReason: 'SCRIPT_ERROR' as const,
			foundInTop: false,
			minutes: 78,
			scan: { found: false, maxPage: 5, pagesParsed: 1, totalResults: 0 },
			failure: { stage: 'target_not_found', details: { target: site.url, parsed: ['vc.ru', 'habr.com', 'rbc.ru'] } },
		},
		{
			id: 'seed-exec-captcha',
			task: t(4),
			status: 'FAILED' as const,
			failureReason: 'CAPTCHA' as const,
			foundInTop: false,
			minutes: 95,
			scan: null,
			failure: { stage: 'after_search', details: { engine: 'yandex', waited: '5m' } },
		},
		{
			id: 'seed-exec-lock',
			task: t(5),
			status: 'FAILED' as const,
			failureReason: 'LOCK_TIMEOUT' as const,
			foundInTop: false,
			minutes: 120,
			scan: null,
			failure: { stage: 'browser_lock', details: { waitedMs: 420000 } },
		},
		{
			id: 'seed-exec-found',
			task: t(0),
			status: 'COMPLETED' as const,
			failureReason: null,
			foundInTop: true,
			position: 7,
			minutes: 140,
			// Нашли на первой странице — останавливаться было правильно, бейдж не нужен.
			scan: { found: true, maxPage: 5, pagesParsed: 1, totalResults: 10 },
		},
	]

	for (const r of rows) {
		const at = minutesAgo(r.minutes)
		const data = {
			taskId: r.task.id,
			executorId: executor.id,
			websiteId: site.id,
			status: r.status,
			failureReason: r.failureReason,
			foundInTop: r.foundInTop,
			yandexFoundInTop: r.foundInTop,
			position: (r as any).position ?? null,
			yandexPosition: (r as any).position ?? null,
			pointsEarned: r.foundInTop ? 15 : 5,
			pointsSpent: 0,
			pagesVisited: r.scan?.pagesParsed ?? 0,
			duration: 90 + r.minutes,
			createdAt: at,
			completedAt: at,
		}
		await prisma.execution.upsert({ where: { id: r.id }, create: { id: r.id, ...data }, update: data })

		// Событий на выполнение может быть несколько — чистим свои и пишем заново,
		// иначе повторный запуск размножит их.
		await prisma.executionEvent.deleteMany({ where: { executionId: r.id } })
		if (r.scan) {
			await prisma.executionEvent.create({
				data: {
					executionId: r.id, taskId: r.task.id, executorId: executor.id,
					engine: 'yandex', type: 'parser', stage: 'serp_scan_depth',
					details: r.scan, createdAt: at,
				},
			})
		}
		if ((r as any).failure) {
			const f = (r as any).failure
			await prisma.executionEvent.create({
				data: {
					executionId: r.id, taskId: r.task.id, executorId: executor.id,
					engine: 'yandex', type: 'failure', stage: f.stage,
					details: f.details, createdAt: at,
				},
			})
		}

		// Запись в баланс исполнителя — с той самой пометкой про глубину,
		// которую теперь дописывает creditEngine.
		let resultText = r.foundInTop ? 'найдено в поиске' : 'не найдено в поиске'
		if (!r.foundInTop && r.scan) {
			if (r.scan.pagesParsed === 1 && r.scan.maxPage > 1) resultText += ', дальше 1-й страницы не ушли'
			else if (r.scan.pagesParsed > 1) resultText += `, просмотрено ${r.scan.pagesParsed} стр.`
		}
		const histId = `seed-bh-${r.id}`
		const hist = {
			userId: executor.id,
			amount: r.foundInTop ? 15 : 5,
			type: 'TASK_EARNED' as const,
			description: `Поиск "${r.task.keyword}" на ${site.url} — Яндекс (${resultText})`,
			taskId: r.task.id,
			createdAt: at,
		}
		await prisma.balanceHistory.upsert({ where: { id: histId }, create: { id: histId, ...hist }, update: hist })
	}

	console.log(`\n✅ Выполнений: ${rows.length}`)
	console.log(`   • «только 1 стр.» — 2 шт. (красный бейдж в журнале)`)
	console.log(`   • не нашли, но листали 5 страниц — 1 шт. (бейдж НЕ должен появиться)`)
	console.log(`   • ошибки: SCRIPT_ERROR, CAPTCHA, LOCK_TIMEOUT`)
	console.log(`   • успешное с позицией 7 — 1 шт.`)
	console.log(`\n📄 Журнал:  http://localhost:3001/holfizz/logs`)
	console.log(`👤 Профиль: http://localhost:3001/holfizz/users/${userId}`)
	console.log(`💰 Баланс исполнителя: http://localhost:3001/holfizz/users/${executor.id} → «История баланса»`)
}

main()
	.catch(e => {
		console.error(e)
		process.exit(1)
	})
	.finally(() => prisma.$disconnect())
