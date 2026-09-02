/**
 * Тестовая рассылка на себя (ТОЛЬКО дев).
 *
 * Запуск: npx ts-node --transpile-only prisma/seed-tg-outreach.ts
 *
 * Зачем. Проверить рассылку целиком можно только настоящей отправкой, а на
 * незнакомом человеке этого делать нельзя: первое сообщение уходит один раз,
 * и «посмотреть, как получилось» на нём не выйдет. Поэтому сид собирает
 * кампанию из одного адресата — @holfizz, то есть вас.
 *
 * Что делает:
 *   - создаёт кампанию «Проверка на себе» с обычным текстом первого касания;
 *   - кладёт в неё одного адресата @holfizz с именем и сайтом, чтобы
 *     подстановки заполнились и сообщение прошло проверку на ФИО;
 *   - подключает аккаунты, у которых сессия настоящая (тестовые пропускает);
 *   - СНИМАЕТ с них прокси: в деве прокси нерабочие, а тут нужен реальный
 *     коннект. В бою так делать нельзя, и об этом сид предупреждает.
 *
 * Идемпотентно: свою кампанию находит по названию и пересоздаёт.
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const NAME = 'Проверка на себе'
const TARGET = 'holfizz'

const FIRST = `{фио}, здравствуйте, ждал будние, чтобы вам написать

Могу с вами пообщаться по поводу сайта - {сайт} ?
Я по работе`

// Вторая часть большого сообщения. В кампании нет данных выдачи по адресату
// — ни позиций, ни конкурентов, — поэтому здесь только постоянные блоки.
// Полный вариант с позициями собирается в кабинете менеджера, где эти данные
// есть: см. buildOutreachMessage в src/outreach/outreach-message.ts.
const SECOND = `Мы занимаемся продвижением сайтов в топ-10 Яндекса. Из поиска переходы идут бесплатно, в отличие от Директа, где вы платите за каждый клик. Работаем по позициям - рост видно в отчете, платите за результат

Давайте пришлю бесплатный отчет: где вы сейчас, кто выше и сколько людей в месяц ищет эти запросы. Посмотрите - если интересно, обсудим, как поднять. Прислать?`

async function main() {
	if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) {
		console.error('[ОТКАЗ] Сид только для локальной базы: он снимает прокси с аккаунтов.')
		process.exit(1)
	}

	const old = await prisma.tgCampaign.findFirst({ where: { name: NAME }, select: { id: true } })
	if (old) {
		await prisma.tgCampaign.delete({ where: { id: old.id } })
		console.log('Прошлая проверочная кампания удалена')
	}

	// Тестовые аккаунты из демо-сида подключать бессмысленно: у них выдуманные
	// сессии, коннекта не будет.
	const accounts = await prisma.tgAccount.findMany({
		where: { status: { notIn: ['BANNED'] }, NOT: { label: { startsWith: 'ТЕСТ ·' } } },
		select: { id: true, label: true, status: true, proxyId: true },
	})
	if (!accounts.length) {
		console.error('[ОТКАЗ] Нет ни одного аккаунта с настоящей сессией. Загрузите его в «Прогрев ТГ».')
		process.exit(1)
	}

	const campaign = await prisma.tgCampaign.create({
		data: {
			name: NAME,
			status: 'DRAFT', // запускать руками, чтобы отправка не случилась неожиданно
			firstMessage: FIRST,
			secondMessage: SECOND,
			perAccountPerDay: 1, // одному человеку — одно сообщение, больше не надо
			minIntervalSec: 60,
			maxIntervalSec: 120,
			windowFrom: 0, // круглосуточно: проверка не должна ждать до утра
			windowTo: 24,
			accounts: { create: accounts.map(a => ({ accountId: a.id })) },
			recipients: {
				create: [{
					username: TARGET,
					// Имя произвольное: адресат — вы сами, а тексту нужно чем-то
					// заполнить {фио}, иначе сообщение не пройдёт проверку.
					firstName: 'Максим',
					middleName: 'Андреевич',
					company: 'ООО «Кухни Вологда»',
					domain: 'kuhni-vologda.ru',
				}],
			},
		},
		select: { id: true },
	})

	// Прокси снимаем: в деве они нерабочие, а проверке нужен живой коннект.
	const withProxy = accounts.filter(a => a.proxyId)
	if (withProxy.length) {
		await prisma.tgAccount.updateMany({
			where: { id: { in: withProxy.map(a => a.id) } },
			data: { proxyId: null },
		})
	}

	console.log(`\nКампания «${NAME}» готова: ${campaign.id}`)
	console.log(`Адресат: @${TARGET} — имя «Максим Андреевич», сайт kuhni-vologda.ru`)
	console.log('Аккаунты:')
	for (const a of accounts) console.log(`  ${a.label} — ${a.status}${a.proxyId ? ' (прокси снят)' : ' (прокси не было)'}`)
	console.log('\nЧто дальше:')
	console.log('  1. Админка -> Рассылка ТГ -> «Проверка на себе»')
	console.log('  2. Настройки -> «Проверить на себе»: отправит вам текст, не трогая очередь')
	console.log('  3. Либо «Запустить» — уйдёт одно сообщение на @holfizz из очереди')
	console.log('  4. Ответьте себе и посмотрите: придёт ли уведомление в бот и появится ли переписка')
	console.log('\nВНИМАНИЕ: аккаунты идут БЕЗ прокси, с адреса сервера. Это нормально для проверки,')
	console.log('но перед боевой рассылкой прокси надо вернуть, иначе весь пул выйдет с одного IP.')
}

main()
	.catch(e => {
		console.error(e)
		process.exit(1)
	})
	.finally(() => prisma.$disconnect())
