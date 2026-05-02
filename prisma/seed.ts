import { PrismaClient } from '@prisma/client'
import * as bcrypt from 'bcrypt'

const prisma = new PrismaClient()

// Функция для генерации случайной даты в диапазоне
function randomDate(start: Date, end: Date): Date {
	return new Date(
		start.getTime() + Math.random() * (end.getTime() - start.getTime()),
	)
}

// Функция для генерации случайного числа в диапазоне
function randomInt(min: number, max: number): number {
	return Math.floor(Math.random() * (max - min + 1)) + min
}

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

	// ========================================
	// СОЗДАЕМ ГЛАВНЫЙ АККАУНТ asd11@gmail.com
	// ========================================
	console.log('\n🎯 Creating main account asd11@gmail.com with statistics...')

	const mainUser = await prisma.user.upsert({
		where: { email: 'asd11@gmail.com' },
		update: {
			balance: 15000,
			emailVerified: true,
		},
		create: {
			email: 'asd11@gmail.com',
			password: hashedPassword,
			balance: 15000,
			city: 'Москва',
			referralSource: 'Google Ads',
			userType: 'ENTREPRENEUR',
			emailVerified: true,
		},
	})

	console.log(
		`✓ Created main user: ${mainUser.email} with balance ${mainUser.balance}`,
	)

	// Создаем сайты для главного аккаунта
	const mainWebsite1 = await prisma.website.create({
		data: {
			userId: mainUser.id,
			name: 'Интернет-магазин техники TechStore',
			url: 'https://techstore-moscow.ru',
			city: 'Москва',
			isActive: true,
		},
	})

	const mainWebsite2 = await prisma.website.create({
		data: {
			userId: mainUser.id,
			name: 'Сервис доставки еды FoodExpress',
			url: 'https://foodexpress-msk.ru',
			city: 'Москва',
			isActive: true,
		},
	})

	const mainWebsite3 = await prisma.website.create({
		data: {
			userId: mainUser.id,
			name: 'Онлайн-школа программирования CodeAcademy',
			url: 'https://codeacademy-online.ru',
			city: 'Москва',
			isActive: true,
		},
	})

	console.log(
		`  ✓ Created 3 websites: ${mainWebsite1.name}, ${mainWebsite2.name}, ${mainWebsite3.name}`,
	)

	// Создаем задачи для TechStore
	const mainTasks1 = await Promise.all([
		prisma.task.create({
			data: {
				websiteId: mainWebsite1.id,
				type: 'SEARCH_AND_VISIT',
				keyword: 'купить ноутбук москва',
				geo: 'Москва',
				pointsCost: 10,
				maxYandexVisits: 5,
				maxGoogleVisits: 5,
				useYandex: true,
				useGoogle: true,
				pagesDepthFrom: 3,
				pagesDepthTo: 6,
				pageDurationFrom: 60,
				pageDurationTo: 180,
				isActive: true,
			},
		}),
		prisma.task.create({
			data: {
				websiteId: mainWebsite1.id,
				type: 'SEARCH_AND_VISIT',
				keyword: 'купить смартфон недорого',
				geo: 'Москва',
				pointsCost: 10,
				maxYandexVisits: 4,
				maxGoogleVisits: 4,
				useYandex: true,
				useGoogle: true,
				pagesDepthFrom: 2,
				pagesDepthTo: 5,
				pageDurationFrom: 45,
				pageDurationTo: 150,
				isActive: true,
			},
		}),
		prisma.task.create({
			data: {
				websiteId: mainWebsite1.id,
				type: 'SEARCH_AND_VISIT',
				keyword: 'интернет магазин электроники москва',
				geo: 'Москва',
				pointsCost: 10,
				maxYandexVisits: 6,
				maxGoogleVisits: 6,
				useYandex: true,
				useGoogle: true,
				pagesDepthFrom: 3,
				pagesDepthTo: 7,
				pageDurationFrom: 70,
				pageDurationTo: 200,
				isActive: true,
			},
		}),
		prisma.task.create({
			data: {
				websiteId: mainWebsite1.id,
				type: 'SEARCH_AND_VISIT',
				keyword: 'купить планшет в москве',
				geo: 'Москва',
				pointsCost: 10,
				maxYandexVisits: 5,
				maxGoogleVisits: 5,
				useYandex: true,
				useGoogle: true,
				pagesDepthFrom: 3,
				pagesDepthTo: 5,
				pageDurationFrom: 50,
				pageDurationTo: 160,
				isActive: true,
			},
		}),
	])

	// Создаем задачи для FoodExpress
	const mainTasks2 = await Promise.all([
		prisma.task.create({
			data: {
				websiteId: mainWebsite2.id,
				type: 'SEARCH_AND_VISIT',
				keyword: 'доставка еды москва',
				geo: 'Москва',
				pointsCost: 10,
				maxYandexVisits: 7,
				maxGoogleVisits: 7,
				useYandex: true,
				useGoogle: true,
				pagesDepthFrom: 2,
				pagesDepthTo: 4,
				pageDurationFrom: 40,
				pageDurationTo: 120,
				isActive: true,
			},
		}),
		prisma.task.create({
			data: {
				websiteId: mainWebsite2.id,
				type: 'SEARCH_AND_VISIT',
				keyword: 'заказать еду на дом москва',
				geo: 'Москва',
				pointsCost: 10,
				maxYandexVisits: 6,
				maxGoogleVisits: 6,
				useYandex: true,
				useGoogle: true,
				pagesDepthFrom: 3,
				pagesDepthTo: 5,
				pageDurationFrom: 50,
				pageDurationTo: 140,
				isActive: true,
			},
		}),
		prisma.task.create({
			data: {
				websiteId: mainWebsite2.id,
				type: 'SEARCH_AND_VISIT',
				keyword: 'быстрая доставка еды мск',
				geo: 'Москва',
				pointsCost: 10,
				maxYandexVisits: 5,
				maxGoogleVisits: 5,
				useYandex: true,
				useGoogle: true,
				pagesDepthFrom: 2,
				pagesDepthTo: 4,
				pageDurationFrom: 35,
				pageDurationTo: 100,
				isActive: true,
			},
		}),
	])

	// Создаем задачи для CodeAcademy
	const mainTasks3 = await Promise.all([
		prisma.task.create({
			data: {
				websiteId: mainWebsite3.id,
				type: 'SEARCH_AND_VISIT',
				keyword: 'курсы программирования онлайн',
				geo: 'Москва',
				pointsCost: 10,
				maxYandexVisits: 5,
				maxGoogleVisits: 5,
				useYandex: true,
				useGoogle: true,
				pagesDepthFrom: 4,
				pagesDepthTo: 8,
				pageDurationFrom: 90,
				pageDurationTo: 300,
				isActive: true,
			},
		}),
		prisma.task.create({
			data: {
				websiteId: mainWebsite3.id,
				type: 'SEARCH_AND_VISIT',
				keyword: 'обучение программированию с нуля',
				geo: 'Москва',
				pointsCost: 10,
				maxYandexVisits: 4,
				maxGoogleVisits: 4,
				useYandex: true,
				useGoogle: true,
				pagesDepthFrom: 3,
				pagesDepthTo: 7,
				pageDurationFrom: 80,
				pageDurationTo: 250,
				isActive: true,
			},
		}),
		prisma.task.create({
			data: {
				websiteId: mainWebsite3.id,
				type: 'SEARCH_AND_VISIT',
				keyword: 'онлайн школа программирования москва',
				geo: 'Москва',
				pointsCost: 10,
				maxYandexVisits: 6,
				maxGoogleVisits: 6,
				useYandex: true,
				useGoogle: true,
				pagesDepthFrom: 4,
				pagesDepthTo: 9,
				pageDurationFrom: 100,
				pageDurationTo: 320,
				isActive: true,
			},
		}),
	])

	const allMainTasks = [...mainTasks1, ...mainTasks2, ...mainTasks3]
	console.log(`  ✓ Created ${allMainTasks.length} tasks for all websites`)

	// ========================================
	// СОЗДАЕМ ИСПОЛНИТЕЛЕЙ (боты для накрутки)
	// ========================================
	console.log('\n🤖 Creating executor accounts...')

	const executorEmails = [
		'executor1@bot.com',
		'executor2@bot.com',
		'executor3@bot.com',
		'executor4@bot.com',
		'executor5@bot.com',
		'executor6@bot.com',
		'executor7@bot.com',
		'executor8@bot.com',
	]

	const executors = []
	for (const email of executorEmails) {
		const executor = await prisma.user.upsert({
			where: { email },
			update: {
				balance: 5000,
				emailVerified: true,
			},
			create: {
				email,
				password: hashedPassword,
				balance: 5000,
				city: ['Москва', 'Санкт-Петербург', 'Казань', 'Новосибирск'][
					randomInt(0, 3)
				],
				referralSource: 'Bot',
				userType: 'MARKETER',
				emailVerified: true,
			},
		})
		executors.push(executor)
	}

	console.log(`✓ Created ${executors.length} executor accounts`)

	// ========================================
	// ГЕНЕРИРУЕМ СТАТИСТИКУ ЗА ПОСЛЕДНИЕ 30 ДНЕЙ
	// ========================================
	console.log('\n📊 Generating statistics for last 30 days...')

	const now = new Date()
	const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

	let totalExecutions = 0
	let totalStatistics = 0

	// Для каждой задачи создаем выполнения и статистику
	for (const task of allMainTasks) {
		const keyword = task.keyword || 'unknown'

		// Генерируем статистику за каждый день последних 30 дней
		for (let day = 0; day < 30; day++) {
			const date = new Date(thirtyDaysAgo.getTime() + day * 24 * 60 * 60 * 1000)

			// Количество выполнений в этот день (от 2 до 8)
			const executionsPerDay = randomInt(2, 8)

			let yandexVisitsToday = 0
			let googleVisitsToday = 0
			let yandexSearchesToday = 0
			let googleSearchesToday = 0

			// Позиция в выдаче (улучшается со временем)
			const basePosition = 45 - Math.floor((day / 30) * 30) // От 45 до 15
			const positionVariation = randomInt(-5, 5)
			const position = Math.max(
				1,
				Math.min(50, basePosition + positionVariation),
			)

			// Создаем выполнения для этого дня
			for (let i = 0; i < executionsPerDay; i++) {
				const executor = executors[randomInt(0, executors.length - 1)]
				const useYandex = Math.random() > 0.5
				const foundInTop = position <= 50

				const execution = await prisma.execution.create({
					data: {
						taskId: task.id,
						executorId: executor.id,
						websiteId: task.websiteId,
						status: 'COMPLETED',
						pointsEarned: 8,
						pointsSpent: 10,
						foundInTop,
						position: foundInTop ? position : null,
						pagesVisited: randomInt(task.pagesDepthFrom, task.pagesDepthTo),
						duration: randomInt(
							task.pageDurationFrom * task.pagesDepthFrom,
							task.pageDurationTo * task.pagesDepthTo,
						),
						ipAddress: `192.168.${randomInt(1, 255)}.${randomInt(1, 255)}`,
						userAgent:
							'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
						weekStart: new Date(
							date.getTime() - date.getDay() * 24 * 60 * 60 * 1000,
						),
						createdAt: randomDate(
							new Date(date.setHours(8, 0, 0, 0)),
							new Date(date.setHours(22, 0, 0, 0)),
						),
						completedAt: randomDate(
							new Date(date.setHours(8, 0, 0, 0)),
							new Date(date.setHours(22, 0, 0, 0)),
						),
					},
				})

				totalExecutions++

				if (useYandex) {
					yandexSearchesToday++
					if (foundInTop) yandexVisitsToday++
				} else {
					googleSearchesToday++
					if (foundInTop) googleVisitsToday++
				}

				// Создаем историю позиций
				await prisma.positionHistory.create({
					data: {
						taskId: task.id,
						yandexPosition: useYandex && foundInTop ? position : null,
						googlePosition: !useYandex && foundInTop ? position : null,
						date: execution.createdAt,
						createdAt: execution.createdAt,
					},
				})
			}

			// Определяем категорию позиции
			let inTop1 = 0,
				inTop2_3 = 0,
				inTop5 = 0,
				inTop10 = 0,
				inTop50 = 0,
				belowTop50 = 0

			if (position === 1) inTop1 = executionsPerDay
			else if (position <= 3) inTop2_3 = executionsPerDay
			else if (position <= 5) inTop5 = executionsPerDay
			else if (position <= 10) inTop10 = executionsPerDay
			else if (position <= 50) inTop50 = executionsPerDay
			else belowTop50 = executionsPerDay

			// Создаем статистику за день
			await prisma.statistic.create({
				data: {
					websiteId: task.websiteId,
					keyword,
					position: position <= 50 ? position : null,
					inTop1,
					inTop2_3,
					inTop5,
					inTop10,
					inTop50,
					belowTop50,
					totalVisits: yandexVisitsToday + googleVisitsToday,
					yandexSearches: yandexSearchesToday,
					googleSearches: googleSearchesToday,
					yandexVisits: yandexVisitsToday,
					googleVisits: googleVisitsToday,
					date: new Date(date.setHours(0, 0, 0, 0)),
					createdAt: new Date(date.setHours(0, 0, 0, 0)),
				},
			})

			totalStatistics++
		}
	}

	console.log(`✓ Generated ${totalExecutions} executions`)
	console.log(`✓ Generated ${totalStatistics} statistics records`)

	// Создаем историю баланса для главного пользователя
	console.log('\n💰 Creating balance history...')

	await prisma.balanceHistory.create({
		data: {
			userId: mainUser.id,
			amount: 1000,
			type: 'WELCOME_BONUS',
			description: 'Приветственный бонус',
			createdAt: new Date(thirtyDaysAgo),
		},
	})

	await prisma.balanceHistory.create({
		data: {
			userId: mainUser.id,
			amount: 5000,
			type: 'PAYMENT',
			description: 'Пополнение баланса',
			createdAt: new Date(thirtyDaysAgo.getTime() + 5 * 24 * 60 * 60 * 1000),
		},
	})

	await prisma.balanceHistory.create({
		data: {
			userId: mainUser.id,
			amount: 10000,
			type: 'PAYMENT',
			description: 'Пополнение баланса',
			createdAt: new Date(thirtyDaysAgo.getTime() + 15 * 24 * 60 * 60 * 1000),
		},
	})

	// Списания за задачи
	for (let i = 0; i < 50; i++) {
		await prisma.balanceHistory.create({
			data: {
				userId: mainUser.id,
				amount: -10,
				type: 'TASK_SPENT',
				description: 'Списание за выполнение задачи',
				createdAt: randomDate(thirtyDaysAgo, now),
			},
		})
	}

	console.log('✓ Created balance history')

	console.log('\n✅ Seed completed successfully!')
	console.log('\n📋 Test accounts (all with password: password123):')
	console.log('   • test1@test.com (Москва, Маркетолог)')
	console.log('   • test2@test.com (Санкт-Петербург, SEO)')
	console.log('   • test3@test.com (Новосибирск, Предприниматель)')
	console.log('   • test4@test.com (Екатеринбург, Стартапер)')
	console.log('   • test5@test.com (Казань, Маркетолог)')
	console.log('   • lol@lol.com (Москва)')
	console.log('   • lol@lol.lol (Москва)')
	console.log('\n🎯 MAIN ACCOUNT WITH STATISTICS:')
	console.log('   • asd11@gmail.com (Москва, Предприниматель)')
	console.log('     - 3 websites with 10 tasks total')
	console.log(`     - ${totalExecutions} executions over 30 days`)
	console.log(`     - ${totalStatistics} statistics records`)
	console.log('     - Balance: 15,000 points')
	console.log('\n🤖 Executor accounts:')
	console.log(`   - ${executors.length} bot accounts (executor1-8@bot.com)`)
	console.log('\n💰 All accounts have balance and are email verified')
}

main()
	.catch(e => {
		console.error(e)
		process.exit(1)
	})
	.finally(async () => {
		await prisma.$disconnect()
	})
