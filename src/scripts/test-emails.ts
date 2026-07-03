/**
 * Тестовый скрипт для отправки всех email шаблонов
 * Использование: npx ts-node src/scripts/test-emails.ts
 */

import { NestFactory } from '@nestjs/core'
import { AppModule } from '../app.module'
import { NotificationsService } from '../notifications/notifications.service'

async function testEmails() {
	console.log('🚀 Запуск тестовой отправки email шаблонов...\n')

	const app = await NestFactory.createApplicationContext(AppModule)
	const notificationsService = app.get(NotificationsService)

	const testEmail = 'gorlach7v@gmail.com'
	const testToken = 'test-verification-token-12345'

	try {
		// 1. Приветственное письмо с подтверждением email
		console.log('📧 1/6 Отправка приветственного письма...')
		await notificationsService.sendWelcomeAndVerificationEmail(
			testEmail,
			testToken,
		)
		console.log('✅ Приветственное письмо отправлено\n')
		await sleep(2000)

		// 2. Подтверждение email (повторная отправка)
		console.log('📧 2/6 Отправка письма подтверждения email...')
		await notificationsService.sendEmailVerification(testEmail, testToken)
		console.log('✅ Письмо подтверждения отправлено\n')
		await sleep(2000)

		// 3. Низкий баланс
		console.log('📧 3/6 Отправка уведомления о низком балансе...')
		await notificationsService.sendLowBalanceEmail(testEmail, 50)
		console.log('✅ Уведомление о низком балансе отправлено\n')
		await sleep(2000)

		// 4. Успешный платеж
		console.log('📧 4/6 Отправка подтверждения платежа...')
		await notificationsService.sendPaymentSuccessEmail(testEmail, 500, 5000)
		console.log('✅ Подтверждение платежа отправлено\n')
		await sleep(2000)

		// 5. Восстановление пароля
		console.log('📧 5/6 Отправка письма восстановления пароля...')
		await notificationsService.sendPasswordResetEmail(
			testEmail,
			'test-reset-token-67890',
		)
		console.log('✅ Письмо восстановления пароля отправлено\n')
		await sleep(2000)

		// 6. Еженедельный отчет
		console.log('📧 6/6 Отправка еженедельного отчета...')
		await notificationsService.sendWeeklyReport(testEmail, {
			balance: 12500,
			weeklyEarned: 3200,
			tasksCompleted: 48,
			found: 35,
			websites: [
				{
					name: 'Мой Сайт',
					url: 'https://example.com',
					tasks: [
						{
							keyword: 'купить телефон москва',
							positionHistory: [
								{ yandexPosition: 8, googlePosition: 12 },
								{ yandexPosition: 15, googlePosition: 18 },
							],
						},
						{
							keyword: 'ремонт компьютеров',
							positionHistory: [
								{ yandexPosition: 3, googlePosition: 5 },
								{ yandexPosition: 5, googlePosition: 7 },
							],
						},
						{
							keyword: 'доставка еды',
							positionHistory: [
								{ yandexPosition: null, googlePosition: 25 },
								{ yandexPosition: null, googlePosition: 30 },
							],
						},
					],
				},
				{
					name: 'Второй Проект',
					url: 'https://example2.com',
					tasks: [
						{
							keyword: 'seo продвижение',
							positionHistory: [
								{ yandexPosition: 6, googlePosition: 8 },
								{ yandexPosition: 10, googlePosition: 12 },
							],
						},
					],
				},
			],
		})
		console.log('✅ Еженедельный отчет отправлен\n')
		await sleep(2000)

		// 7. Рост позиции
		console.log('📧 7/10 Отправка письма о росте позиции...')
		await notificationsService.sendPositionRiseEmail(testEmail, {
			keyword: 'купить сумку биркин москва',
			siteName: 'Мой Сайт',
			oldPos: 13,
			newPos: 8,
		})
		console.log('✅ Письмо о росте позиции отправлено\n')
		await sleep(2000)

		// 8. Сайт одобрен
		console.log('📧 8/10 Отправка письма об одобрении сайта...')
		await notificationsService.sendSiteApprovedEmail(testEmail, 'Мой Сайт')
		console.log('✅ Письмо об одобрении отправлено\n')
		await sleep(2000)

		// 9. Сайт отклонён
		console.log('📧 9/10 Отправка письма об отклонении сайта...')
		await notificationsService.sendSiteRejectedEmail(testEmail, 'Мой Сайт')
		console.log('✅ Письмо об отклонении отправлено\n')
		await sleep(2000)

		// 10. Скидка на брошенный платёж
		console.log('📧 10/10 Отправка письма со скидкой на брошенный платёж...')
		await notificationsService.sendAbandonedPaymentEmail(testEmail, {
			points: 50000,
			amount: 4941,
			url: 'https://skyseo.site/payment/repeat?token=demo',
		})
		console.log('✅ Письмо со скидкой отправлено\n')

		console.log('🎉 Все письма успешно отправлены на', testEmail)
		console.log('📬 Проверьте почту (включая папку "Спам")')
	} catch (error) {
		console.error('❌ Ошибка при отправке писем:', error)
	} finally {
		await app.close()
		// Принудительный выход: фоновые setInterval (планировщики) иначе держат процесс
		process.exit(0)
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms))
}

testEmails()
