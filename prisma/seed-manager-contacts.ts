/**
 * Тестовые контакты для кабинета менеджера (ТОЛЬКО дев).
 *
 * Запуск: npx ts-node --transpile-only prisma/seed-manager-contacts.ts
 *
 * Зачем отдельный сид: очередь менеджера показывает лида только если у него
 * telegramManual = true, а второе сообщение и PDF-отчёт строятся из строк
 * выдачи (SerpRow), а не из полей лида. То есть «просто вставить пару лидов»
 * недостаточно: без прогона у них будет пустой текст и пустой отчёт.
 *
 * Что создаёт:
 *   - один прогон парсера с выдачей по 4 запросам;
 *   - позиции лидов в окне 15-50, конкурентов на 9 и 10 местах;
 *   - 6 лидов с ручным телеграмом, ФИО, реквизитами и токеном отчёта;
 *   - двоих из них помечает ответившими, чтобы проверить второй шаг.
 *
 * Идемпотентно: перед вставкой сносит свой же прогон по метке в query.
 *
 * ВАЖНО ПРО ЮЗЕРНЕЙМЫ. Они начинаются с zz_test_ не для красоты. Пространство
 * имён в Telegram общее и настоящее: любой правдоподобно выдуманный @ivan_petrov
 * может принадлежать живому человеку. Один такой лид из этого сида уже попал в
 * боевую рассылку, и незнакомцу ушло письмо с выдуманным именем и выдуманным
 * сайтом. Поэтому здесь заведомо несуществующие хвосты, а автоматический набор
 * контактов такие лиды пропускает по метке в notes.
 */
import { PrismaClient } from '@prisma/client'
import { randomBytes } from 'crypto'

const prisma = new PrismaClient()

// Метка, по которой сид находит и удаляет свои прошлые данные.
const MARK = '[дев-сид] кабинет менеджера'

/**
 * Метка в notes. По ней автоматический набор контактов отсеивает эти лиды:
 * они выдуманные, и рассылать по ним нельзя. Значение продублировано в
 * src/tg-warmup/campaign.service.ts — держать их в синхроне.
 */
export const SEED_NOTE = 'Тестовый лид из дев-сида'

const KEYWORDS = [
	'кухни на заказ',
	'шкаф купе на заказ',
	'гардеробная на заказ',
	'кухонный гарнитур цена',
]

// Домены, которые встают на 9 и 10 местах — из них собираются «конкуренты».
const RIVALS = ['mebel-lider.ru', 'kuhni-premium.ru', 'shkaf-master.ru', 'domkuhni.ru']

type Seed = {
	domain: string
	company: string
	first: string
	middle: string
	last: string
	tg: string
	phone: string
	email: string
	city: string
	inn: string
	// запрос → позиция лида (обязательно 15-50, иначе он не лид)
	positions: Record<string, number>
	replied?: boolean
	/**
	 * Куда лид попадёт в кабинете:
	 *   ready  — телеграм подтверждён, сразу в «Контакты» (по умолчанию)
	 *   search — телеграма нет, лежит в «Поиске контактов» без статуса
	 *   failed — в «Поиске» с отметкой «не удалось найти»
	 */
	mode?: 'ready' | 'search' | 'failed'
}

const LEADS: Seed[] = [
	{
		domain: 'kuhni-vologda.ru', company: 'ООО «Кухни Вологда»',
		first: 'Сергей', middle: 'Петрович', last: 'Ильин',
		tg: '@zz_test_ilyin_kuhni', phone: '+74951234567', email: 'info@kuhni-vologda.ru',
		city: 'Москва', inn: '7736207543',
		positions: { 'кухни на заказ': 17, 'кухонный гарнитур цена': 24 },
	},
	{
		domain: 'shkafy-doma.ru', company: 'ООО «Шкафы Дома»',
		first: 'Оксана', middle: 'Александровна', last: 'Гринёва',
		tg: '@zz_test_grineva_shkafy', phone: '+74959876543', email: 'zakaz@shkafy-doma.ru',
		city: 'Москва', inn: '7728168971',
		positions: { 'шкаф купе на заказ': 15, 'гардеробная на заказ': 21, 'кухни на заказ': 38 },
	},
	{
		domain: 'garderob-pro.ru', company: 'ИП Тарасов Александр Геннадьевич',
		first: 'Александр', middle: 'Геннадьевич', last: 'Тарасов',
		tg: '@zz_test_tarasov_garderob', phone: '+79161112233', email: 'a.tarasov@garderob-pro.ru',
		city: 'Москва', inn: '503014816133',
		positions: { 'гардеробная на заказ': 19, 'шкаф купе на заказ': 33 },
	},
	{
		domain: 'mebelnaya-fabrika-77.ru', company: 'ООО «Мебельная фабрика 77»',
		first: 'Юрий', middle: 'Сергеевич', last: 'Кривошеин',
		tg: '@zz_test_krivoshein77', phone: '+74952223344', email: 'sales@mebelnaya-fabrika-77.ru',
		city: 'Москва', inn: '9703172271',
		positions: { 'кухни на заказ': 28, 'кухонный гарнитур цена': 31, 'шкаф купе на заказ': 44 },
	},
	{
		domain: 'kuhni-na-zakaz-msk.ru', company: 'ООО «Кухни на заказ»',
		first: 'Марина', middle: 'Викторовна', last: 'Соболева',
		tg: '@zz_test_soboleva_mebel', phone: '+74953334455', email: 'm.soboleva@kuhni-na-zakaz-msk.ru',
		city: 'Москва', inn: '9726024625',
		positions: { 'кухонный гарнитур цена': 16, 'кухни на заказ': 22 },
		replied: true,
	},
	{
		domain: 'stolyarnaya-masterskaya.ru', company: 'ИП Гавва Алексей Викторович',
		first: 'Алексей', middle: 'Викторович', last: 'Гавва',
		tg: '@zz_test_gavva_wood', phone: '+79267778899', email: 'gavva@stolyarnaya-masterskaya.ru',
		city: 'Москва', inn: '7716802625',
		positions: { 'шкаф купе на заказ': 26, 'гардеробная на заказ': 45 },
		replied: true,
	},
	// Ниже — для вкладки «Поиск контактов»: ИНН есть, владелец ещё не найден.
	{
		domain: 'kuhni-standart.ru', company: 'ООО «Кухни Стандарт»',
		first: '', middle: '', last: '',
		tg: '', phone: '+74954445566', email: 'info@kuhni-standart.ru',
		city: 'Москва', inn: '7724152639',
		positions: { 'кухни на заказ': 25, 'кухонный гарнитур цена': 40 },
		mode: 'search',
	},
	{
		domain: 'shkaf-i-ko.ru', company: 'ООО «Шкаф и Ко»',
		first: '', middle: '', last: '',
		tg: '', phone: '+74955556677', email: 'zakaz@shkaf-i-ko.ru',
		city: 'Москва', inn: '9724152639',
		positions: { 'шкаф купе на заказ': 29, 'гардеробная на заказ': 36 },
		mode: 'search',
	},
	{
		domain: 'mebel-atelier.ru', company: 'ООО «Мебель Ателье»',
		first: '', middle: '', last: '',
		tg: '', phone: '+74956667788', email: 'hello@mebel-atelier.ru',
		city: 'Москва', inn: '7710140679',
		positions: { 'кухни на заказ': 34 },
		mode: 'search',
	},
	{
		domain: 'garderobnye-systemy.ru', company: 'ООО «Гардеробные системы»',
		first: '', middle: '', last: '',
		tg: '', phone: '+74957778899', email: 'info@garderobnye-systemy.ru',
		city: 'Москва', inn: '7702070139',
		positions: { 'гардеробная на заказ': 42 },
		mode: 'failed',
	},
]

async function main() {
	const dbUrl = process.env.DATABASE_URL ?? ''
	// Защита от запуска по проду: сид создаёт лидов в боевой базе аутрича,
	// и отличить их потом от настоящих будет нечем.
	if (!/localhost|127\.0\.0\.1/.test(dbUrl)) {
		console.error('[ОТКАЗ] Сид только для локальной базы. DATABASE_URL указывает не на localhost.')
		process.exit(1)
	}

	const old = await prisma.serpImport.findMany({ where: { query: MARK }, select: { id: true } })
	if (old.length) {
		// Лиды и строки выдачи уедут каскадом по importId, но лид ссылается через
		// SetNull, поэтому его сносим руками, иначе останутся сироты без выдачи.
		const ids = old.map(o => o.id)
		const removedLeads = await prisma.outreachLead.deleteMany({ where: { importId: { in: ids } } })
		await prisma.serpImport.deleteMany({ where: { id: { in: ids } } })
		console.log(`Прошлый дев-сид удалён: прогонов ${ids.length}, лидов ${removedLeads.count}`)
	}

	const imp = await prisma.serpImport.create({
		data: { query: MARK, region: 'Москва', createdBy: 'seed' },
	})

	// Строки выдачи: конкуренты на 9 и 10 по каждому запросу + сами лиды.
	const rows: { importId: string; keyword: string; position: number; domain: string; url: string; title: string }[] = []
	for (const [i, keyword] of KEYWORDS.entries()) {
		rows.push(
			{ importId: imp.id, keyword, position: 9, domain: RIVALS[i % RIVALS.length], url: `https://${RIVALS[i % RIVALS.length]}/`, title: 'Конкурент 9' },
			{ importId: imp.id, keyword, position: 10, domain: RIVALS[(i + 1) % RIVALS.length], url: `https://${RIVALS[(i + 1) % RIVALS.length]}/`, title: 'Конкурент 10' },
		)
	}
	for (const lead of LEADS) {
		for (const [keyword, position] of Object.entries(lead.positions)) {
			rows.push({ importId: imp.id, keyword, position, domain: lead.domain, url: `https://${lead.domain}/`, title: lead.company })
		}
	}
	await prisma.serpRow.createMany({ data: rows })

	// Менеджер, от чьего имени отмечаются касания у «ответивших».
	const manager = await prisma.user.findFirst({
		where: { OR: [{ role: 'MANAGER' }, { roles: { has: 'MANAGER' } }] },
		select: { id: true, email: true },
	})

	let fresh = 0
	let replied = 0
	let search = 0
	let failed = 0
	for (const l of LEADS) {
		const positions = Object.entries(l.positions).sort((a, b) => a[1] - b[1])
		const best = positions[0][1]
		const competitors = KEYWORDS.filter(k => k in l.positions).flatMap((k, i) => [
			{ keyword: k, position: 9, domain: RIVALS[i % RIVALS.length] },
			{ keyword: k, position: 10, domain: RIVALS[(i + 1) % RIVALS.length] },
		])

		const lead = await prisma.outreachLead.create({
			data: {
				domain: l.domain,
				importId: imp.id,
				companyName: l.company,
				firstName: l.first || null,
				middleName: l.middle || null,
				lastName: l.last || null,
				city: l.city,
				inn: l.inn,
				phone: l.phone,
				email: l.email,
				whatsapp: l.phone,
				telegram: l.tg || null,
				// Главное для очереди: без этого флага менеджер лида не увидит,
				// он останется во вкладке «Поиск контактов».
				telegramManual: (l.mode ?? 'ready') === 'ready',
				contactSearchFailed: l.mode === 'failed',
				contact: l.tg || l.phone,
				channel: l.tg ? 'Telegram' : 'Телефон',
				keywords: positions.map(([k, p]) => `${k} (${p})`).join('; '),
				keywordsCount: positions.length,
				bestPosition: best,
				score: positions.length * 10 + Math.max(0, 50 - best),
				competitors,
				reportToken: randomBytes(16).toString('hex'),
				notes: SEED_NOTE,
				message: '', // соберётся при первом открытии карточки
				status: l.replied ? 'INTERESTED' : 'NEW',
			},
		})

		if (l.mode === 'failed') failed++
		else if (l.mode === 'search') search++
		else if (l.replied && manager) {
			await prisma.outreachTouch.create({ data: { leadId: lead.id, userId: manager.id, step: 1 } })
			replied++
		} else {
			fresh++
		}
	}

	console.log(`Прогон: ${imp.id}`)
	console.log(`Строк выдачи: ${rows.length}`)
	console.log(`Лидов: ${LEADS.length}`)
	console.log(`  Контакты → «Стартовое»: ${fresh}, «Второе»: ${replied}`)
	console.log(`  Поиск    → «Без статуса»: ${search}, «Не удалось найти»: ${failed}`)
	if (!manager) {
		console.log('ВНИМАНИЕ: пользователя с ролью MANAGER нет, касания не проставлены — все лиды попадут в первый шаг.')
	} else {
		console.log(`Касания отмечены от: ${manager.email}`)
	}
}

main()
	.catch(e => {
		console.error(e)
		process.exit(1)
	})
	.finally(() => prisma.$disconnect())
