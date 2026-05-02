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

	console.log(
		'🎯 Creating main account asd11@gmail.com with rich statistics...\n',
	)

	const mainUser = await prisma.user.upsert({
		where: { email: 'asd11@gmail.com' },
		update: {
			balance: 25000,
			emailVerified: true,
		},
		create: {
			email: 'asd11@gmail.com',
			password: hashedPassword,
			balance: 25000,
			city: 'Москва',
			referralSource: 'Google Ads',
			userType: 'ENTREPRENEUR',
			emailVerified: true,
		},
	})

	console.log(
		`✓ Created user: ${mainUser.email} with balance ${mainUser.balance}`,
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

	console.log(`✓ Created 3 websites\n`)

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
		prisma.task.create({
			data: {
				websiteId: mainWebsite1.id,
				type: 'SEARCH_AND_VISIT',
				keyword: 'купить наушники москва',
				geo: 'Москва',
				pointsCost: 10,
				maxYandexVisits: 5,
				maxGoogleVisits: 5,
				useYandex: true,
				useGoogle: true,
				pagesDepthFrom: 2,
				pagesDepthTo: 4,
				pageDurationFrom: 40,
				pageDurationTo: 120,
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
		prisma.task.create({
			data: {
				websiteId: mainWebsite2.id,
				type: 'SEARCH_AND_VISIT',
				keyword: 'доставка пиццы москва',
				geo: 'Москва',
				pointsCost: 10,
				maxYandexVisits: 6,
				maxGoogleVisits: 6,
				useYandex: true,
				useGoogle: true,
				pagesDepthFrom: 2,
				pagesDepthTo: 3,
				pageDurationFrom: 30,
				pageDurationTo: 90,
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
		prisma.task.create({
			data: {
				websiteId: mainWebsite3.id,
				type: 'SEARCH_AND_VISIT',
				keyword: 'курсы javascript москва',
				geo: 'Москва',
				pointsCost: 10,
				maxYandexVisits: 5,
				maxGoogleVisits: 5,
				useYandex: true,
				useGoogle: true,
				pagesDepthFrom: 3,
				pagesDepthTo: 6,
				pageDurationFrom: 70,
				pageDurationTo: 200,
				isActive: true,
			},
		}),
	])

	const allMainTasks = [...mainTasks1, ...mainTasks2, ...mainTasks3]
	console.log(`✓ Created ${allMainTasks.length} tasks\n`)

	// ========================================
	// СОЗДАЕМ ИСПОЛНИТЕЛЕЙ (боты для накрутки)
	// ========================================
	console.log('🤖 Creating executor accounts...')

	const executorEmails = [
		'executor1@bot.com',
		'executor2@bot.com',
		'executor3@bot.com',
		'executor4@bot.com',
		'executor5@bot.com',
		'executor6@bot.com',
		'executor7@bot.com',
		'executor8@bot.com',
		'executor9@bot.com',
		'executor10@bot.com',
		'executor11@bot.com',
		'executor12@bot.com',
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
				city: [
					'Москва',
					'Санкт-Петербург',
					'Казань',
					'Новосибирск',
					'Екатеринбург',
				][randomInt(0, 4)],
				referralSource: 'Bot',
				userType: 'MARKETER',
				emailVerified: true,
			},
		})
		executors.push(executor)
	}

	console.log(`✓ Created ${executors.length} executor accounts\n`)

	// ========================================
	// ГЕНЕРИРУЕМ СТАТИСТИКУ ЗА ПОСЛЕДНИЕ 60 ДНЕЙ (для тренда ±7д)
	// ========================================
	console.log('📊 Generating statistics for last 60 days...\n')

	const now = new Date()
	const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000)

	let totalExecutions = 0
	let totalStatistics = 0
	let totalPositionHistory = 0

	// Для каждой задачи создаем выполнения и статистику
	for (const task of allMainTasks) {
		const keyword = task.keyword || 'unknown'

		// Начальные позиции для Яндекс и Google (разные для каждого ключевика)
		let yandexBasePosition = randomInt(40, 50)
		let googleBasePosition = randomInt(35, 48)

		// Генерируем статистику за каждый день последних 60 дней
		for (let day = 0; day < 60; day++) {
			const date = new Date(sixtyDaysAgo.getTime() + day * 24 * 60 * 60 * 1000)

			// Количество выполнений в этот день (от 5 до 15)
			const executionsPerDay = randomInt(5, 15)

			let yandexVisitsToday = 0
			let googleVisitsToday = 0
			let yandexSearchesToday = 0
			let googleSearchesToday = 0

			// Позиции улучшаются со временем с небольшими колебаниями
			// Яндекс улучшается быстрее (более агрессивная накрутка)
			const yandexImprovement = day < 30 ? randomInt(0, 2) : randomInt(0, 1)
			const yandexFluctuation = Math.random() > 0.75 ? randomInt(0, 4) : 0
			yandexBasePosition = Math.max(
				3,
				yandexBasePosition - yandexImprovement + yandexFluctuation,
			)

			// Google улучшается медленнее
			const googleImprovement = day < 30 ? randomInt(0, 1) : randomInt(0, 1)
			const googleFluctuation = Math.random() > 0.7 ? randomInt(0, 3) : 0
			googleBasePosition = Math.max(
				5,
				googleBasePosition - googleImprovement + googleFluctuation,
			)

			const yandexPosition = Math.max(
				1,
				Math.min(50, yandexBasePosition + randomInt(-2, 2)),
			)
			const googlePosition = Math.max(
				1,
				Math.min(50, googleBasePosition + randomInt(-2, 2)),
			)

			// Создаем выполнения для этого дня
			for (let i = 0; i < executionsPerDay; i++) {
				const executor = executors[randomInt(0, executors.length - 1)]
				const useYandex = Math.random() > 0.42 // 58% Яндекс, 42% Google
				const position = useYandex ? yandexPosition : googlePosition
				const foundInTop = position <= 50 && Math.random() > 0.08 // 92% находят

				const executionDate = randomDate(
					new Date(
						date.getFullYear(),
						date.getMonth(),
						date.getDate(),
						8,
						0,
						0,
						0,
					),
					new Date(
						date.getFullYear(),
						date.getMonth(),
						date.getDate(),
						22,
						0,
						0,
						0,
					),
				)

				await prisma.execution.create({
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
						createdAt: executionDate,
						completedAt: new Date(
							executionDate.getTime() + randomInt(120, 600) * 1000,
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
			}

			// Создаем историю позиций (по одной записи в день для каждого поисковика)
			// Яндекс - утром
			await prisma.positionHistory.create({
				data: {
					taskId: task.id,
					yandexPosition: yandexPosition <= 50 ? yandexPosition : null,
					googlePosition: null,
					date: new Date(
						date.getFullYear(),
						date.getMonth(),
						date.getDate(),
						10,
						0,
						0,
						0,
					),
					createdAt: new Date(
						date.getFullYear(),
						date.getMonth(),
						date.getDate(),
						10,
						0,
						0,
						0,
					),
				},
			})
			totalPositionHistory++

			// Google - днем
			await prisma.positionHistory.create({
				data: {
					taskId: task.id,
					yandexPosition: null,
					googlePosition: googlePosition <= 50 ? googlePosition : null,
					date: new Date(
						date.getFullYear(),
						date.getMonth(),
						date.getDate(),
						15,
						0,
						0,
						0,
					),
					createdAt: new Date(
						date.getFullYear(),
						date.getMonth(),
						date.getDate(),
						15,
						0,
						0,
						0,
					),
				},
			})
			totalPositionHistory++

			// Определяем категорию позиции (берем среднюю)
			const avgPosition = Math.round((yandexPosition + googlePosition) / 2)
			let inTop1 = 0,
				inTop2_3 = 0,
				inTop5 = 0,
				inTop10 = 0,
				inTop50 = 0,
				belowTop50 = 0

			if (avgPosition === 1) inTop1 = executionsPerDay
			else if (avgPosition <= 3) inTop2_3 = executionsPerDay
			else if (avgPosition <= 5) inTop5 = executionsPerDay
			else if (avgPosition <= 10) inTop10 = executionsPerDay
			else if (avgPosition <= 50) inTop50 = executionsPerDay
			else belowTop50 = executionsPerDay

			// Создаем статистику за день
			await prisma.statistic.create({
				data: {
					websiteId: task.websiteId,
					keyword,
					position: avgPosition <= 50 ? avgPosition : null,
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
					date: new Date(
						date.getFullYear(),
						date.getMonth(),
						date.getDate(),
						0,
						0,
						0,
						0,
					),
					createdAt: new Date(
						date.getFullYear(),
						date.getMonth(),
						date.getDate(),
						0,
						0,
						0,
						0,
					),
				},
			})

			totalStatistics++
		}

		console.log(`  ✓ Generated stats for: ${keyword}`)
	}

	console.log(`\n✓ Generated ${totalExecutions} executions`)
	console.log(`✓ Generated ${totalStatistics} statistics records`)
	console.log(`✓ Generated ${totalPositionHistory} position history records\n`)

	// Создаем историю баланса для главного пользователя
	console.log('💰 Creating balance history...')

	const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

	await prisma.balanceHistory.create({
		data: {
			userId: mainUser.id,
			amount: 1000,
			type: 'WELCOME_BONUS',
			description: 'Приветственный бонус',
			createdAt: new Date(sixtyDaysAgo),
		},
	})

	await prisma.balanceHistory.create({
		data: {
			userId: mainUser.id,
			amount: 5000,
			type: 'PAYMENT',
			description: 'Пополнение баланса',
			createdAt: new Date(sixtyDaysAgo.getTime() + 5 * 24 * 60 * 60 * 1000),
		},
	})

	await prisma.balanceHistory.create({
		data: {
			userId: mainUser.id,
			amount: 10000,
			type: 'PAYMENT',
			description: 'Пополнение баланса',
			createdAt: new Date(sixtyDaysAgo.getTime() + 20 * 24 * 60 * 60 * 1000),
		},
	})

	await prisma.balanceHistory.create({
		data: {
			userId: mainUser.id,
			amount: 15000,
			type: 'PAYMENT',
			description: 'Пополнение баланса',
			createdAt: new Date(thirtyDaysAgo.getTime() + 10 * 24 * 60 * 60 * 1000),
		},
	})

	// Списания за задачи (распределенные по времени)
	for (let i = 0; i < 100; i++) {
		await prisma.balanceHistory.create({
			data: {
				userId: mainUser.id,
				amount: -10,
				type: 'TASK_SPENT',
				description: 'Списание за выполнение задачи',
				createdAt: randomDate(sixtyDaysAgo, now),
			},
		})
	}

	console.log('✓ Created balance history\n')

	console.log('✅ Seed completed successfully!\n')
	console.log('🎯 MAIN ACCOUNT WITH RICH STATISTICS:')
	console.log('   • Email: asd11@gmail.com')
	console.log('   • Password: password123')
	console.log('   • Balance: 25,000 points')
	console.log('   • Websites: 3 (TechStore, FoodExpress, CodeAcademy)')
	console.log(`   • Keywords: ${allMainTasks.length}`)
	console.log(`   • Executions: ${totalExecutions} over 60 days`)
	console.log(`   • Statistics: ${totalStatistics} daily records`)
	console.log(`   • Position History: ${totalPositionHistory} records`)
	console.log('\n📊 Statistics features:')
	console.log('   • Positions improve over time (from ~45 to ~5-10)')
	console.log('   • Separate Yandex and Google tracking')
	console.log('   • ±7 days trend data available')
	console.log('   • Visibility in top-10 calculated')
	console.log('   • Average positions for both search engines')
	console.log('\n🤖 Executor accounts:')
	console.log(`   • ${executors.length} bot accounts (executor1-12@bot.com)`)
	console.log('   • Password: password123')
}

main()
	.catch(e => {
		console.error(e)
		process.exit(1)
	})
	.finally(async () => {
		await prisma.$disconnect()
	})
