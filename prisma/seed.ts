import { PrismaClient } from '@prisma/client'
import * as bcrypt from 'bcrypt'

const prisma = new PrismaClient()

async function main() {
	// Создаем тестового пользователя lol@lol.com
	const hashedPassword = await bcrypt.hash('password123', 10)

	const user = await prisma.user.upsert({
		where: { email: 'lol@lol.com' },
		update: {},
		create: {
			email: 'lol@lol.com',
			password: hashedPassword,
			balance: 2500,
			city: 'Москва',
			referralSource: 'Google',
		},
	})

	console.log('Created user:', user.email)

	// Создаем второго пользователя lol@lol.lol с активными задачами
	const user2 = await prisma.user.upsert({
		where: { email: 'lol@lol.lol' },
		update: {},
		create: {
			email: 'lol@lol.lol',
			password: hashedPassword,
			balance: 5000,
			city: 'Москва',
			referralSource: 'Telegram',
		},
	})

	console.log('Created user:', user2.email)

	// Создаем сайты
	const website1 = await prisma.website.create({
		data: {
			userId: user.id,
			name: 'Интернет-магазин электроники',
			url: 'https://example-electronics.ru',
			city: 'Москва',
			isActive: true,
		},
	})

	const website2 = await prisma.website.create({
		data: {
			userId: user.id,
			name: 'Блог о путешествиях',
			url: 'https://travel-blog.ru',
			city: 'Санкт-Петербург',
			isActive: true,
		},
	})

	console.log('Created websites:', website1.name, website2.name)

	// Создаем сайты для второго пользователя (lol@lol.lol)
	const website3 = await prisma.website.create({
		data: {
			userId: user2.id,
			name: 'Golden Goose Москва',
			url: 'https://goldengoose.moscow',
			city: 'Москва',
			isActive: true,
		},
	})

	const website4 = await prisma.website.create({
		data: {
			userId: user2.id,
			name: 'Golden Goose Vercel',
			url: 'https://ggose.vercel.app',
			city: 'Москва',
			isActive: true,
		},
	})

	console.log('Created websites for user2:', website3.name, website4.name)

	// Создаем задачи для Golden Goose
	const tasks3 = await Promise.all([
		prisma.task.create({
			data: {
				websiteId: website3.id,
				type: 'SEARCH_AND_VISIT',
				keyword: 'купить golden goose москва',
				geo: 'Москва',
				pointsCost: 10,
				maxYandexVisits: 5,
				maxGoogleVisits: 5,
				useYandex: true,
				useGoogle: true,
				pagesDepthFrom: 3,
				pagesDepthTo: 5,
				pageDurationFrom: 60,
				pageDurationTo: 180,
				isActive: true,
			},
		}),
		prisma.task.create({
			data: {
				websiteId: website3.id,
				type: 'SEARCH_AND_VISIT',
				keyword: 'golden goose мск',
				geo: 'Москва',
				pointsCost: 10,
				maxYandexVisits: 4,
				maxGoogleVisits: 4,
				useYandex: true,
				useGoogle: true,
				pagesDepthFrom: 3,
				pagesDepthTo: 5,
				pageDurationFrom: 60,
				pageDurationTo: 180,
				isActive: true,
			},
		}),
		prisma.task.create({
			data: {
				websiteId: website3.id,
				type: 'SEARCH_AND_VISIT',
				keyword: 'голден гус москва',
				geo: 'Москва',
				pointsCost: 10,
				maxYandexVisits: 6,
				maxGoogleVisits: 6,
				useYandex: true,
				useGoogle: true,
				pagesDepthFrom: 3,
				pagesDepthTo: 5,
				pageDurationFrom: 60,
				pageDurationTo: 180,
				isActive: true,
			},
		}),
		prisma.task.create({
			data: {
				websiteId: website3.id,
				type: 'SEARCH_AND_VISIT',
				keyword: 'купить голден гус в москве',
				geo: 'Москва',
				pointsCost: 10,
				maxYandexVisits: 5,
				maxGoogleVisits: 5,
				useYandex: true,
				useGoogle: true,
				pagesDepthFrom: 3,
				pagesDepthTo: 5,
				pageDurationFrom: 60,
				pageDurationTo: 180,
				isActive: true,
			},
		}),
	])

	console.log('Created tasks for user2:', tasks3.length)

	// Создаем задачи для ggose.vercel.app
	const tasks4 = await Promise.all([
		prisma.task.create({
			data: {
				websiteId: website4.id,
				type: 'SEARCH_AND_VISIT',
				keyword: 'golden goose купить в москве',
				geo: 'Москва',
				pointsCost: 10,
				maxYandexVisits: 5,
				maxGoogleVisits: 5,
				useYandex: true,
				useGoogle: true,
				pagesDepthFrom: 2,
				pagesDepthTo: 4,
				pageDurationFrom: 30,
				pageDurationTo: 90,
				isActive: true,
			},
		}),
		prisma.task.create({
			data: {
				websiteId: website4.id,
				type: 'SEARCH_AND_VISIT',
				keyword: 'golden goose купить в мск',
				geo: 'Москва',
				pointsCost: 10,
				maxYandexVisits: 3,
				maxGoogleVisits: 3,
				useYandex: true,
				useGoogle: true,
				pagesDepthFrom: 2,
				pagesDepthTo: 3,
				pageDurationFrom: 30,
				pageDurationTo: 60,
				isActive: true,
			},
		}),
	])

	console.log('Created tasks for ggose.vercel.app:', tasks4.length)
	console.log('Test user: lol@lol.com / password123')
}

main()
	.catch(e => {
		console.error(e)
		process.exit(1)
	})
	.finally(async () => {
		await prisma.$disconnect()
	})
