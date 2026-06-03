/**
 * Сидер данных для конкретного пользователя
 * Usage: npx ts-node prisma/seed-user.ts gorlach7v@gmail.com
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const EMAIL = process.argv[2] || 'gorlach7v@gmail.com'

function rnd(min: number, max: number) {
	return Math.floor(Math.random() * (max - min + 1)) + min
}

function daysAgo(n: number) {
	const d = new Date()
	d.setDate(d.getDate() - n)
	return d
}

function hoursAgo(n: number) {
	return new Date(Date.now() - n * 3600_000)
}

async function main() {
	const user = await prisma.user.findUnique({ where: { email: EMAIL } })
	if (!user) { console.error(`User not found: ${EMAIL}`); process.exit(1) }

	console.log(`Seeding data for ${user.email} (id=${user.id})`)

	// ── 1. Сайты + ключи ──────────────────────────────────────────────────────
	const sites = [
		{ name: 'Мой интернет-магазин', url: 'https://example-shop.ru' },
		{ name: 'Туристическое агентство', url: 'https://travel-demo.ru' },
	]

	const keywords = [
		['купить кроссовки москва', 'кроссовки интернет магазин', 'nike air москва', 'купить adidas дешево', 'спортивная обувь цены'],
		['туры в турцию 2026', 'горящие путевки из москвы', 'отдых на море недорого', 'туры всё включено цены'],
	]

	const createdSites: any[] = []
	for (let si = 0; si < sites.length; si++) {
		const existing = await prisma.website.findFirst({ where: { userId: user.id, url: sites[si].url } })
		const site = existing ?? await prisma.website.create({
			data: { userId: user.id, ...sites[si], city: 'Москва', isActive: true, dailyVisitsTarget: 30 },
		})
		createdSites.push(site)
		console.log(`  Site: ${site.name}`)

		for (const kw of keywords[si]) {
			const exists = await prisma.task.findFirst({ where: { websiteId: site.id, keyword: kw } })
			if (!exists) {
				await prisma.task.create({
					data: {
						websiteId: site.id, keyword: kw,
						type: 'SEARCH_AND_VISIT', useYandex: true, useGoogle: true,
						maxYandexVisits: rnd(3, 8), maxGoogleVisits: rnd(3, 8),
						isActive: true, status: 'PENDING',
					},
				})
			}
		}
	}

	// ── 2. Получаем все tasks ─────────────────────────────────────────────────
	const allTasks = await prisma.task.findMany({ where: { website: { userId: user.id } } })
	console.log(`  Tasks: ${allTasks.length}`)

	// ── 3. Executors — другие пользователи (или сам) ─────────────────────────
	const executors = await prisma.user.findMany({ take: 10, orderBy: { createdAt: 'asc' } })
	const executorIds = executors.map(e => e.id)

	// ── 4. Executions за 30 дней ──────────────────────────────────────────────
	let exCount = 0
	for (let day = 29; day >= 0; day--) {
		const baseDate = daysAgo(day)
		const perDay = rnd(8, 25)

		for (let i = 0; i < perDay; i++) {
			const task = allTasks[rnd(0, allTasks.length - 1)]
			const useY = Math.random() > 0.4
			const yPos = rnd(1, 60)
			const gPos = rnd(1, 60)
			const yFound = useY && yPos <= 50
			const gFound = !useY && gPos <= 50
			const foundInTop = yFound || gFound
			const executorId = executorIds[rnd(0, executorIds.length - 1)]

			const createdAt = new Date(baseDate.getTime() + rnd(0, 3600_000 * 8))
			const completedAt = new Date(createdAt.getTime() + rnd(15_000, 120_000))

			await prisma.execution.create({
				data: {
					taskId: task.id, executorId,
					status: 'COMPLETED',
					foundInTop,
					position: foundInTop ? (yFound ? yPos : gPos) : null,
					yandexFoundInTop: useY ? yFound : null,
					googleFoundInTop: !useY ? gFound : null,
					yandexPosition: useY && yFound ? yPos : null,
					googlePosition: !useY && gFound ? gPos : null,
					pointsSpent: foundInTop ? 30 : 10,
					pointsEarned: 0,
					createdAt, completedAt,
				},
			})

			// PositionHistory
			if (foundInTop) {
				await prisma.positionHistory.create({
					data: {
						taskId: task.id,
						yandexPosition: useY && yFound ? yPos : null,
						googlePosition: !useY && gFound ? gPos : null,
						date: createdAt, createdAt,
					},
				}).catch(() => {})
			}

			exCount++
		}
	}
	console.log(`  Executions created: ${exCount}`)

	// ── 5. BalanceHistory — пополнения и начисления ───────────────────────────
	const historyItems = [
		{ amount: 1000, type: 'WELCOME_BONUS', description: 'Приветственный бонус', daysBack: 29 },
		{ amount: 9990, type: 'PAYMENT', description: 'Пополнение баланса', daysBack: 25 },
		{ amount: -30, type: 'TASK_SPENT', description: 'Списание за визит Яндекс', daysBack: 20 },
		{ amount: 15, type: 'TASK_EARNED', description: 'Начисление за задачу Яндекс', daysBack: 18 },
		{ amount: -30, type: 'TASK_SPENT', description: 'Списание за визит Google', daysBack: 15 },
		{ amount: 15, type: 'TASK_EARNED', description: 'Начисление за задачу Google', daysBack: 14 },
		{ amount: 9990, type: 'PAYMENT', description: 'Пополнение баланса', daysBack: 10 },
		{ amount: -30, type: 'TASK_SPENT', description: 'Списание за визит', daysBack: 7 },
		{ amount: 15, type: 'TASK_EARNED', description: 'Начисление за задачу', daysBack: 5 },
		{ amount: -10, type: 'TASK_SPENT', description: 'Списание (сайт не в топ)', daysBack: 3 },
		{ amount: 5, type: 'TASK_EARNED', description: 'Начисление (сайт не найден)', daysBack: 2 },
		{ amount: -30, type: 'TASK_SPENT', description: 'Списание за визит', daysBack: 1 },
	]

	for (const item of historyItems) {
		await prisma.balanceHistory.create({
			data: {
				userId: user.id, amount: item.amount,
				type: item.type as any, description: item.description,
				createdAt: daysAgo(item.daysBack),
			},
		}).catch(() => {})
	}
	console.log(`  BalanceHistory: ${historyItems.length} items`)

	// ── 6. Обновляем баланс если маленький ────────────────────────────────────
	if (user.balance < 5000) {
		await prisma.user.update({ where: { id: user.id }, data: { balance: 50000 } })
		console.log(`  Balance updated to 50000`)
	}

	console.log('✅ Done!')
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
