/**
 * Dev seed: очищает всё в dev-БД и создаёт чистый аккаунт для тестирования.
 * ТОЛЬКО для dev (DATABASE_URL должен указывать на skyseo_dev).
 * Usage: npx ts-node prisma/seed-dev.ts
 */
import { PrismaClient } from '@prisma/client'
import * as bcrypt from 'bcrypt'

const prisma = new PrismaClient()

async function main() {
	const dbUrl = process.env.DATABASE_URL ?? ''
	if (!dbUrl.includes('skyseo_dev') && !dbUrl.includes('localhost')) {
		console.error('❌ Отказ: DATABASE_URL не похож на dev-базу. Прод не трогаем.')
		process.exit(1)
	}

	console.log('🗑  Очищаем dev-данные...')

	// Удаляем всё каскадно (порядок важен из-за FK)
	await prisma.executionEvent.deleteMany()
	await prisma.positionHistory.deleteMany()
	await prisma.execution.deleteMany()
	await prisma.balanceHistory.deleteMany()
	await prisma.payment.deleteMany()
	await prisma.task.deleteMany()
	await prisma.website.deleteMany()
	await prisma.user.deleteMany()

	console.log('✅ Очищено')

	// Новый тестовый аккаунт
	const email = 'dev@skyseo.test'
	const password = 'dev123456'
	const hash = await bcrypt.hash(password, 10)

	const user = await prisma.user.create({
		data: {
			email,
			password: hash,
			balance: 100000,
			emailVerified: true,
			appStatus: 'ACTIVE',
			createdAt: new Date(),
		},
	})
	console.log(`👤 Пользователь создан: ${email} / ${password}`)
	console.log(`   id: ${user.id}`)

	// Сайт
	const website = await prisma.website.create({
		data: {
			userId: user.id,
			name: 'Goose Store',
			url: 'https://ggoose.vercel.app',
			city: 'Москва',
			isActive: true,
			dailyVisitsTarget: 10,
		},
	})
	console.log(`🌐 Сайт создан: ${website.url}`)

	// Одна задача с ключевиком
	const task = await prisma.task.create({
		data: {
			websiteId: website.id,
			keyword: 'купить голден гус в москве',
			type: 'SEARCH_AND_VISIT',
			useYandex: true,
			useGoogle: true,
			maxYandexVisits: 10,
			maxGoogleVisits: 10,
			isActive: true,
			status: 'PENDING',
			keywordStatus: 'ACTIVE',
		},
	})
	console.log(`🔑 Задача создана: "${task.keyword}"`)

	// Приветственный бонус в историю баланса
	await prisma.balanceHistory.create({
		data: {
			userId: user.id,
			amount: 100000,
			type: 'WELCOME_BONUS',
			description: 'Dev: начальный баланс',
		},
	})

	console.log('\n✅ Dev-сидер готов!')
	console.log(`   Email: ${email}`)
	console.log(`   Пароль: ${password}`)
	console.log(`   Баланс: 100 000 баллов`)
	console.log(`   Сайт: https://ggoose.vercel.app`)
	console.log(`   Ключевик: "купить голден гус в москве"`)
}

main()
	.catch(e => { console.error(e); process.exit(1) })
	.finally(() => prisma.$disconnect())
