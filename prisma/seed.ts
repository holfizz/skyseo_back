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
			name: 'Магазин одежды',
			url: 'https://fashion-store.ru',
			city: 'Москва',
			isActive: true,
		},
	})

	const website4 = await prisma.website.create({
		data: {
			userId: user2.id,
			name: 'Сервис доставки еды',
			url: 'https://food-delivery.ru',
			city: 'Москва',
			isActive: true,
		},
	})

	const website5 = await prisma.website.create({
		data: {
			userId: user2.id,
			name: 'Онлайн-школа программирования',
			url: 'https://code-school.ru',
			city: 'Москва',
			isActive: true,
		},
	})

	console.log(
		'Created websites for user2:',
		website3.name,
		website4.name,
		website5.name,
	)

	// Создаем задачи (ключевые слова) для первого сайта
	const tasks1 = await Promise.all([
		prisma.task.create({
			data: {
				websiteId: website1.id,
				type: 'SEARCH_AND_VISIT',
				keyword: 'купить iphone 15 pro',
				geo: 'Москва',
				pointsCost: 10,
				maxYandexVisits: 5,
				maxGoogleVisits: 5,
				isActive: true,
			},
		}),
		prisma.task.create({
			data: {
				websiteId: website1.id,
				type: 'SEARCH_AND_VISIT',
				keyword: 'macbook air m2 цена',
				geo: 'Москва',
				pointsCost: 10,
				maxYandexVisits: 3,
				maxGoogleVisits: 3,
				isActive: true,
			},
		}),
		prisma.task.create({
			data: {
				websiteId: website1.id,
				type: 'SEARCH_AND_VISIT',
				keyword: 'наушники airpods pro',
				geo: 'Москва',
				pointsCost: 10,
				maxYandexVisits: 4,
				maxGoogleVisits: 4,
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
				keyword: 'куда поехать отдыхать',
				geo: 'Санкт-Петербург',
				pointsCost: 10,
				maxYandexVisits: 3,
				maxGoogleVisits: 3,
				isActive: true,
			},
		}),
		prisma.task.create({
			data: {
				websiteId: website2.id,
				type: 'SEARCH_AND_VISIT',
				keyword: 'лучшие пляжи мира',
				geo: 'Санкт-Петербург',
				pointsCost: 10,
				maxYandexVisits: 3,
				maxGoogleVisits: 3,
				isActive: true,
			},
		}),
	])

	console.log('Created tasks:', tasks1.length + tasks2.length)

	// Создаем задачи для пользователя lol@lol.lol (много активных задач)
	const tasks3 = await Promise.all([
		// Задачи для магазина одежды
		prisma.task.create({
			data: {
				websiteId: website3.id,
				type: 'SEARCH_AND_VISIT',
				keyword: 'купить джинсы мужские',
				geo: 'Москва',
				pointsCost: 10,
				maxYandexVisits: 5,
				maxGoogleVisits: 5,
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
				keyword: 'женские платья интернет магазин',
				geo: 'Москва',
				pointsCost: 10,
				maxYandexVisits: 4,
				maxGoogleVisits: 4,
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
				keyword: 'кроссовки nike air max',
				geo: 'Москва',
				pointsCost: 10,
				maxYandexVisits: 6,
				maxGoogleVisits: 6,
				pagesDepthFrom: 3,
				pagesDepthTo: 5,
				pageDurationFrom: 60,
				pageDurationTo: 180,
				isActive: true,
			},
		}),
		// Задачи для доставки еды
		prisma.task.create({
			data: {
				websiteId: website4.id,
				type: 'SEARCH_AND_VISIT',
				keyword: 'доставка пиццы москва',
				geo: 'Москва',
				pointsCost: 10,
				maxYandexVisits: 5,
				maxGoogleVisits: 5,
				pagesDepthFrom: 2,
				pagesDepthTo: 4,
				pageDurationFrom: 45,
				pageDurationTo: 120,
				isActive: true,
			},
		}),
		prisma.task.create({
			data: {
				websiteId: website4.id,
				type: 'SEARCH_AND_VISIT',
				keyword: 'заказать суши онлайн',
				geo: 'Москва',
				pointsCost: 10,
				maxYandexVisits: 4,
				maxGoogleVisits: 4,
				pagesDepthFrom: 2,
				pagesDepthTo: 4,
				pageDurationFrom: 45,
				pageDurationTo: 120,
				isActive: true,
			},
		}),
		prisma.task.create({
			data: {
				websiteId: website4.id,
				type: 'SEARCH_AND_VISIT',
				keyword: 'еда на дом круглосуточно',
				geo: 'Москва',
				pointsCost: 10,
				maxYandexVisits: 3,
				maxGoogleVisits: 3,
				pagesDepthFrom: 2,
				pagesDepthTo: 4,
				pageDurationFrom: 45,
				pageDurationTo: 120,
				isActive: true,
			},
		}),
		// Задачи для онлайн-школы
		prisma.task.create({
			data: {
				websiteId: website5.id,
				type: 'SEARCH_AND_VISIT',
				keyword: 'курсы программирования онлайн',
				geo: 'Москва',
				pointsCost: 10,
				maxYandexVisits: 5,
				maxGoogleVisits: 5,
				pagesDepthFrom: 4,
				pagesDepthTo: 6,
				pageDurationFrom: 90,
				pageDurationTo: 240,
				isActive: true,
			},
		}),
		prisma.task.create({
			data: {
				websiteId: website5.id,
				type: 'SEARCH_AND_VISIT',
				keyword: 'обучение python с нуля',
				geo: 'Москва',
				pointsCost: 10,
				maxYandexVisits: 4,
				maxGoogleVisits: 4,
				pagesDepthFrom: 4,
				pagesDepthTo: 6,
				pageDurationFrom: 90,
				pageDurationTo: 240,
				isActive: true,
			},
		}),
		prisma.task.create({
			data: {
				websiteId: website5.id,
				type: 'SEARCH_AND_VISIT',
				keyword: 'javascript курсы для начинающих',
				geo: 'Москва',
				pointsCost: 10,
				maxYandexVisits: 5,
				maxGoogleVisits: 5,
				pagesDepthFrom: 4,
				pagesDepthTo: 6,
				pageDurationFrom: 90,
				pageDurationTo: 240,
				isActive: true,
			},
		}),
		prisma.task.create({
			data: {
				websiteId: website5.id,
				type: 'SEARCH_AND_VISIT',
				keyword: 'веб разработка обучение',
				geo: 'Москва',
				pointsCost: 10,
				maxYandexVisits: 3,
				maxGoogleVisits: 3,
				pagesDepthFrom: 4,
				pagesDepthTo: 6,
				pageDurationFrom: 90,
				pageDurationTo: 240,
				isActive: true,
			},
		}),
	])

	console.log('Created tasks for user2:', tasks3.length)

	// Создаем много выполнений (executions) для реалистичной статистики
	console.log('Creating executions...')
	const allTasks = [...tasks1, ...tasks2]
	const executionsToCreate = []

	// Для каждой задачи создаем случайное количество выполнений
	for (const task of allTasks) {
		// Случайное количество выполнений от 30 до 50 для каждой задачи
		const executionCount = Math.floor(Math.random() * 21) + 30

		for (let i = 0; i < executionCount; i++) {
			// Случайная дата за последние 30 дней
			const daysAgo = Math.floor(Math.random() * 30)
			const executionDate = new Date()
			executionDate.setDate(executionDate.getDate() - daysAgo)

			executionsToCreate.push({
				taskId: task.id,
				executorId: user.id,
				status: 'COMPLETED',
				pointsEarned: 5,
				pointsSpent: 10,
				foundInTop: Math.random() > 0.3, // 70% найдено в топе
				position: Math.floor(Math.random() * 50) + 1,
				pagesVisited: Math.floor(Math.random() * 3) + 3, // 3-5 страниц
				duration: Math.floor(Math.random() * 120) + 60, // 60-180 секунд
				createdAt: executionDate,
				completedAt: new Date(executionDate.getTime() + 120000), // +2 минуты
			})
		}
	}

	// Создаем все выполнения одним запросом
	await prisma.execution.createMany({
		data: executionsToCreate,
	})

	console.log(`Created ${executionsToCreate.length} executions`)

	// Создаем историю баланса
	await Promise.all([
		prisma.balanceHistory.create({
			data: {
				userId: user.id,
				type: 'WELCOME_BONUS',
				amount: 1000,
				description: 'Приветственный бонус',
			},
		}),
		prisma.balanceHistory.create({
			data: {
				userId: user.id,
				type: 'TASK_EARNED',
				amount: 5,
				description: 'Выполнение задачи',
			},
		}),
		prisma.balanceHistory.create({
			data: {
				userId: user.id,
				type: 'TASK_EARNED',
				amount: 5,
				description: 'Выполнение задачи',
			},
		}),
		prisma.balanceHistory.create({
			data: {
				userId: user.id,
				type: 'TASK_SPENT',
				amount: -10,
				description: 'Создание задачи',
			},
		}),
		prisma.balanceHistory.create({
			data: {
				userId: user.id,
				type: 'TASK_SPENT',
				amount: -10,
				description: 'Создание задачи',
			},
		}),
		prisma.balanceHistory.create({
			data: {
				userId: user.id,
				type: 'PAYMENT',
				amount: 1500,
				description: 'Пополнение баланса',
			},
		}),
	])

	console.log('Created balance history')

	// Создаем статистику за последние 30 дней
	const today = new Date()
	const statisticsData = []

	// Генерируем данные для каждого ключевого слова за последние 30 дней
	for (let i = 29; i >= 0; i--) {
		const date = new Date(today)
		date.setDate(date.getDate() - i)

		// Статистика для "купить iphone 15 pro"
		const position1 = Math.max(5, 45 - Math.floor(i * 1.3)) // Позиция улучшается со временем
		statisticsData.push({
			websiteId: website1.id,
			keyword: 'купить iphone 15 pro',
			position: position1,
			inTop10: position1 <= 10 ? 1 : 0,
			inTop50: position1 <= 50 ? 1 : 0,
			totalVisits: Math.floor(Math.random() * 10) + 5,
			yandexSearches: Math.floor(Math.random() * 15) + 10,
			googleSearches: Math.floor(Math.random() * 12) + 8,
			yandexVisits: Math.floor(Math.random() * 8) + 3,
			googleVisits: Math.floor(Math.random() * 6) + 2,
			date: date,
		})

		// Статистика для "macbook air m2 цена"
		const position2 = Math.max(3, 40 - Math.floor(i * 1.2))
		statisticsData.push({
			websiteId: website1.id,
			keyword: 'macbook air m2 цена',
			position: position2,
			inTop10: position2 <= 10 ? 1 : 0,
			inTop50: position2 <= 50 ? 1 : 0,
			totalVisits: Math.floor(Math.random() * 8) + 4,
			yandexSearches: Math.floor(Math.random() * 12) + 8,
			googleSearches: Math.floor(Math.random() * 10) + 6,
			yandexVisits: Math.floor(Math.random() * 6) + 2,
			googleVisits: Math.floor(Math.random() * 5) + 2,
			date: date,
		})

		// Статистика для "наушники airpods pro"
		const position3 = Math.max(8, 38 - Math.floor(i * 1.0))
		statisticsData.push({
			websiteId: website1.id,
			keyword: 'наушники airpods pro',
			position: position3,
			inTop10: position3 <= 10 ? 1 : 0,
			inTop50: position3 <= 50 ? 1 : 0,
			totalVisits: Math.floor(Math.random() * 7) + 3,
			yandexSearches: Math.floor(Math.random() * 10) + 7,
			googleSearches: Math.floor(Math.random() * 9) + 5,
			yandexVisits: Math.floor(Math.random() * 5) + 2,
			googleVisits: Math.floor(Math.random() * 4) + 1,
			date: date,
		})

		// Статистика для "куда поехать отдыхать"
		const position4 = Math.max(10, 42 - Math.floor(i * 1.1))
		statisticsData.push({
			websiteId: website2.id,
			keyword: 'куда поехать отдыхать',
			position: position4,
			inTop10: position4 <= 10 ? 1 : 0,
			inTop50: position4 <= 50 ? 1 : 0,
			totalVisits: Math.floor(Math.random() * 6) + 3,
			yandexSearches: Math.floor(Math.random() * 11) + 6,
			googleSearches: Math.floor(Math.random() * 8) + 4,
			yandexVisits: Math.floor(Math.random() * 4) + 2,
			googleVisits: Math.floor(Math.random() * 3) + 1,
			date: date,
		})

		// Статистика для "лучшие пляжи мира"
		const position5 = Math.max(12, 35 - Math.floor(i * 0.8))
		statisticsData.push({
			websiteId: website2.id,
			keyword: 'лучшие пляжи мира',
			position: position5,
			inTop10: position5 <= 10 ? 1 : 0,
			inTop50: position5 <= 50 ? 1 : 0,
			totalVisits: Math.floor(Math.random() * 5) + 2,
			yandexSearches: Math.floor(Math.random() * 9) + 5,
			googleSearches: Math.floor(Math.random() * 7) + 4,
			yandexVisits: Math.floor(Math.random() * 3) + 1,
			googleVisits: Math.floor(Math.random() * 3) + 1,
			date: date,
		})
	}

	// Создаем все записи статистики
	await prisma.statistic.createMany({
		data: statisticsData,
	})

	console.log(
		`Created ${statisticsData.length} statistics entries over 30 days`,
	)

	console.log('✅ Seed completed successfully!')
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
