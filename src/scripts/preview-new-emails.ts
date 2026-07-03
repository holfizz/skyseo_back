/**
 * Отправляет НОВЫЕ письма (рост позиции, баланс <300, сайт одобрен/отклонён, скидка)
 * на gorlach7v@gmail.com для визуального просмотра.
 * Запуск: npm run build && node dist/src/scripts/preview-new-emails.js
 */
import { NestFactory } from '@nestjs/core'
import { AppModule } from '../app.module'
import { NotificationsService } from '../notifications/notifications.service'

const TO = 'gorlach7v@gmail.com'
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function run() {
	const app = await NestFactory.createApplicationContext(AppModule, { logger: false })
	const n = app.get(NotificationsService)

	const tasks: { name: string; fn: () => Promise<void> }[] = [
		{ name: 'низкий баланс (<300)', fn: () => n.sendLowBalanceEmail(TO, 240) },
		{
			name: 'рост позиции',
			fn: () => n.sendPositionRiseEmail(TO, { keyword: 'купить сумку биркин москва', siteName: 'Мой Сайт', oldPos: 13, newPos: 8 }),
		},
		{ name: 'сайт одобрен', fn: () => n.sendSiteApprovedEmail(TO, 'Мой Сайт') },
		{ name: 'сайт отклонён', fn: () => n.sendSiteRejectedEmail(TO, 'Мой Сайт') },
		{
			name: 'скидка на брошенный платёж',
			fn: () => n.sendAbandonedPaymentEmail(TO, { points: 50000, amount: 4941, url: 'https://skyseo.site/payment/repeat?token=demo' }),
		},
	]

	for (const t of tasks) {
		let ok = false
		for (let attempt = 1; attempt <= 6 && !ok; attempt++) {
			try {
				await t.fn()
				ok = true
				console.log(`✅ отправлено: ${t.name}`)
			} catch (e: any) {
				console.log(`… попытка ${attempt} (${t.name}): ${e?.message}`)
				await sleep(8000) // сеть/SMTP флапают — ждём и повторяем
			}
		}
		if (!ok) console.log(`❌ не удалось: ${t.name}`)
		await sleep(4000)
	}

	console.log(`\n🎉 Готово. Проверьте почту ${TO} (в т.ч. «Спам»).`)
	await app.close()
	process.exit(0)
}

run()
