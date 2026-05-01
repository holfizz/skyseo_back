import { PrismaClient } from '@prisma/client'
import * as bcrypt from 'bcrypt'

const prisma = new PrismaClient()

async function main() {
	const hashedPassword = await bcrypt.hash('password123', 10)

	// Создаем несколько тестовых пользователей с 10000 баллов
	const testUsers = [
		{
			email: 'test1@test.com',
			city: 'Москва',
			referralSource: 'Google',
			userType: 'MARKETER' as const,
		},
		{
			email: 'test2@test.com',
			city: 'Санкт-Петербург',
			referralSource: 'Yandex',
			userType: 'SEO' as const,
		},
		{
			email: 'test3@test.com',
			city: 'Новосибирск',
			referralSource: 'Telegram',
			userType: 'ENTREPRENEUR' as const,
		},
		{
			email: 'test4@test.com',
			city: 'Екатеринбург',
			referralSource: 'YouTube',
			userType: 'STARTUP' as const,
		},
		{
			email: 'test5@test.com',
			city: 'Казань',
			referralSource: 'ВКонтакте',
			userType: 'MARKETER' as const,
		},
	]

	console.log('Creating test users with 10000 balance...')

	for (const userData of testUsers) {
		const user = await prisma.user.upsert({
			where: { email: userData.email },
			update: {
				balance: 10000,
				emailVerified: true,
			},
			create: {
				email: userData.email,
				password: hashedPassword,
				balance: 10000,
				city: userData.city,
				referralSource: userData.referralSource,
				userType: userData.userType,
				emailVerified: true,
			},
		})

		console.log(`✓ Created user: ${user.email} with balance ${user.balance}`)

		// Создаем 2 сайта для каждого пользователя
		const website1 = await prisma.website.create({
			data: {
				userId: user.id,
				name: `Интернет-магазин ${userData.city}`,
				url: `https://shop-${user.id}.example.com`,
				city: userData.city,
				isActive: true,
			},
		})

		const website2 = await prisma.website.create({
			data: {
				userId: user.id,
				name: `Блог о бизнесе ${userData.city}`,
				url: `https://blog-${user.id}.example.com`,
				city: userData.city,
				isActive: true,
			},
		})

		console.log(`  ✓ Created websites: ${website1.name}, ${website2.name}`)

		// Создаем задачи для первого сайта
		const tasks1 = await Promise.all([
			prisma.task.create({
				data: {
					websiteId: website1.id,
					type: 'SEARCH_AND_VISIT',
					keyword: `купить товары ${userData.city}`,
					geo: userData.city,
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
					websiteId: website1.id,
					type: 'SEARCH_AND_VISIT',
					keyword: `интернет магазин ${userData.city}`,
					geo: userData.city,
					pointsCost: 10,
					maxYandexVisits: 4,
					maxGoogleVisits: 4,
					useYandex: true,
					useGoogle: true,
					pagesDepthFrom: 2,
					pagesDepthTo: 4,
					pageDurationFrom: 45,
					pageDurationTo: 120,
					isActive: true,
				},
			}),
			prisma.task.create({
				data: {
					websiteId: website1.id,
					type: 'SEARCH_AND_VISIT',
					keyword: `заказать онлайн ${userData.city}`,
					geo: userData.city,
					pointsCost: 10,
					maxYandexVisits: 6,
					maxGoogleVisits: 6,
					useYandex: true,
					useGoogle: true,
					pagesDepthFrom: 3,
					pagesDepthTo: 6,
					pageDurationFrom: 50,
					pageDurationTo: 150,
					isActive: true,
				},
			}),
		])

		// Создаем задачи для второго сайта
		const tasks2 = await Promise.all([
			prisma.task.create({
				data: {
					websiteId: website2.id,
					type: 'SEARCH_AND_VISIT',
					keyword: `бизнес блог ${userData.city}`,
					geo: userData.city,
					pointsCost: 10,
					maxYandexVisits: 3,
					maxGoogleVisits: 3,
					useYandex: true,
					useGoogle: true,
					pagesDepthFrom: 2,
					pagesDepthTo: 4,
					pageDurationFrom: 90,
					pageDurationTo: 240,
					isActive: true,
				},
			}),
			prisma.task.create({
				data: {
					websiteId: website2.id,
					type: 'SEARCH_AND_VISIT',
					keyword: `советы по бизнесу ${userData.city}`,
					geo: userData.city,
					pointsCost: 10,
					maxYandexVisits: 4,
					maxGoogleVisits: 4,
					useYandex: true,
					useGoogle: true,
					pagesDepthFrom: 3,
					pagesDepthTo: 5,
					pageDurationFrom: 120,
					pageDurationTo: 300,
					isActive: true,
				},
			}),
		])

		console.log(
			`  ✓ Created ${tasks1.length + tasks2.length} tasks for both websites`,
		)
	}

	// Создаем оригинального тестового пользователя lol@lol.com
	const user = await prisma.user.upsert({
		where: { email: 'lol@lol.com' },
		update: {
			balance: 10000,
			emailVerified: true,
		},
		create: {
			email: 'lol@lol.com',
			password: hashedPassword,
			balance: 10000,
			city: 'Москва',
			referralSource: 'Google',
			userType: 'MARKETER',
			emailVerified: true,
		},
	})

	console.log(`✓ Created user: ${user.email} with balance ${user.balance}`)

	// Создаем второго пользователя lol@lol.lol с активными задачами
	const user2 = await prisma.user.upsert({
		where: { email: 'lol@lol.lol' },
		update: {
			balance: 10000,
			emailVerified: true,
		},
		create: {
			email: 'lol@lol.lol',
			password: hashedPassword,
			balance: 10000,
			city: 'Москва',
			referralSource: 'Telegram',
			userType: 'SEO',
			emailVerified: true,
		},
	})

	console.log(`✓ Created user: ${user2.email} with balance ${user2.balance}`)

	// Создаем сайты для lol@lol.com
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

	console.log(`  ✓ Created websites: ${website1.name}, ${website2.name}`)

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

	console.log(`  ✓ Created websites: ${website3.name}, ${website4.name}`)

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

	console.log(`  ✓ Created ${tasks3.length} tasks for ${website3.name}`)

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

	console.log(`  ✓ Created ${tasks4.length} tasks for ${website4.name}`)

	console.log('\n✅ Seed completed successfully!')
	console.log('\n📋 Test accounts (all with password: password123):')
	console.log('   • test1@test.com (Москва, Маркетолог)')
	console.log('   • test2@test.com (Санкт-Петербург, SEO)')
	console.log('   • test3@test.com (Новосибирск, Предприниматель)')
	console.log('   • test4@test.com (Екатеринбург, Стартапер)')
	console.log('   • test5@test.com (Казань, Маркетолог)')
	console.log('   • lol@lol.com (Москва)')
	console.log('   • lol@lol.lol (Москва)')
	console.log('\n💰 All accounts have 10,000 balance')
	console.log('📧 All accounts are email verified')
	console.log('🎯 Each account has 2 websites with 5 tasks total')
}

main()
	.catch(e => {
		console.error(e)
		process.exit(1)
	})
	.finally(async () => {
		await prisma.$disconnect()
	})
