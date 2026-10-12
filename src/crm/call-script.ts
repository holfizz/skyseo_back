export type CallQuestion = { key: string; text: string; answer: string; known: boolean; kind?: 'datetime'; optional?: boolean }
export type CallStep = { id: string; title: string; slides: number[]; say: string; questions: CallQuestion[]; commentKey: string; comment: string; hints: Record<string, string> }
export type CallScript = { name: string; site: string; steps: CallStep[] }
type Context = {
	id?: string; firstName?: string | null; middleName?: string | null; lastName?: string | null; company?: string | null; domain?: string | null
	followUpTask?: { dueAt: Date | string; status?: string } | null
	crmLead?: { budgetMin?: number | null; budgetMax?: number | null; budgetComment?: string | null; decisionMaker?: string | null; qualification?: unknown; tasks?: Array<{ kind: string; dueAt: Date | string; followUpRecipientId?: string | null }> } | null
}
type Brief = { domain: string; keywords: Array<{ keyword: string; position: number | null; competitors: Array<{ domain: string; position: number | null }> }> }
const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''
const labels: Record<string, string> = { YES: 'Да', NO: 'Нет', PARTIAL: 'Частично', UNKNOWN: 'Не знает', IN_HOUSE: 'В штате', AGENCY: 'Агентство', FREELANCER: 'Фрилансер', NOW: 'Сейчас', MONTH: 'В течение месяца', LATER: 'Позже', PRICE: 'Цена', EXPERIENCE: 'Опыт', CASES: 'Кейсы', FORECAST: 'Прогноз', TRANSPARENCY: 'Прозрачность', SPEED: 'Скорость', TURNKEY: 'Под ключ', NICHE: 'Опыт в нише', OTHER: 'Другое', DIRECT: 'Директ', ORGANIC: 'Поиск', REFERRALS: 'Рекомендации', TELEGRAM: 'Telegram', SOCIAL: 'Соцсети', AVITO: 'Avito' }
const list = (value: unknown) => Array.isArray(value) ? value.map(code => labels[String(code)] || String(code)).join(', ') : ''

/** The UI and printable prompter use exactly the same personalized script. */
export function buildCallScript(context: Context, brief: Brief | null): CallScript {
	const lead = context.crmLead
	const qualification = lead?.qualification && typeof lead.qualification === 'object' && !Array.isArray(lead.qualification) ? lead.qualification as Record<string, unknown> : {}
	const values: Record<string, string> = Object.fromEntries(Object.entries(qualification).map(([key, value]) => [key, text(value)]))
	values.budgetComment = text(lead?.budgetComment) || (lead?.budgetMin != null || lead?.budgetMax != null ? [lead.budgetMin, lead.budgetMax].filter(value => value != null).join('–') + ' ₽/мес' : '')
	values.decisionMaker = text(lead?.decisionMaker)
	values.currentSeo ||= qualification.hasSeo === 'NO' ? 'SEO пока нет' : [labels[String(qualification.seoProvider)], qualification.seoSatisfied ? `Результат: ${labels[String(qualification.seoSatisfied)]}` : ''].filter(Boolean).join('. ')
	values.currentSources ||= list(qualification.leadSources)
	values.vendorCriteria ||= list(qualification.vendorCriteriaCodes)
	values.callStartAnswer ||= labels[String(qualification.startTiming)] || ''
	values.callTestDecision ||= qualification.testInterest === 'INTERESTED' ? 'Тест интересен' : qualification.testInterest === 'NOT_INTERESTED' ? 'Тест не интересен' : ''
	values.callTestDirection ||= values.priorityCategories || ''
	values.desiredResult ||= text(qualification.targetLeads) ? `${text(qualification.targetLeads)} заявок` : ''
	const followUp = context.followUpTask && context.followUpTask.status !== 'DONE' ? context.followUpTask : lead?.tasks?.find(task => task.kind === 'FOLLOW_UP' && task.followUpRecipientId === context.id)
	values.followUpAt = followUp?.dueAt ? new Date(followUp.dueAt).toISOString() : ''
	const question = (key: string, phrase: string, extra: Partial<CallQuestion> = {}): CallQuestion => ({ key, text: phrase, answer: values[key] || '', known: !!values[key], ...extra })
	const greeting = [context.firstName, context.middleName].filter(Boolean).join(' ') || 'коллега'
	const name = [context.firstName, context.middleName, context.lastName].filter(Boolean).join(' ') || context.company || 'Контакт'
	const site = brief?.domain || context.domain || 'ваш сайт'
	const ranked = (brief?.keywords || []).filter(row => Number.isFinite(row.position) && row.position > 0).sort((a, b) => a.position - b.position)
	const strong = ranked.find(row => row.position <= 10)
	const growth = ranked.find(row => row.position > 10)
	const positions = strong
		? `По запросу «${strong.keyword}» сайт на ${strong.position}-м месте.${growth ? ` По «${growth.keyword}» пока ${growth.position}-е.` : ''} Посмотрим, какие направления для вас важнее.`
		: growth ? `По запросу «${growth.keyword}» сохранено ${growth.position}-е место. Посмотрим, какие страницы можно усилить.`
		: 'По подготовленным данным пока не могу назвать позиции. Сначала выберем нужные запросы и снимем замер.'
	const hints = (overrides: Record<string, string> = {}) => ({
		'Если заинтересован': '«Отлично. Давайте посмотрим следующий пример».',
		'Если сомневается': '«Что именно хотелось бы уточнить?»',
		'Если возражает': '«Понимаю. Что для вас здесь самое важное?»',
		'Если не знает': '«Ничего страшного. Пока оставим этот вопрос и пойдем дальше».',
		'Если вопрос технический': '«Уточню у нашего SEO-специалиста и вернусь с точным ответом».',
		...overrides,
	})
	const step = (id: string, title: string, slides: number[], say: string, questions: CallQuestion[], commentKey: string, overrides: Record<string, string> = {}): CallStep => ({ id, title, slides, say, questions, commentKey, comment: values[commentKey] || '', hints: hints(overrides) })
	return { name, site, steps: [
		step('hello', 'Знакомство', [1], `Здравствуйте, ${greeting}! Рад познакомиться. Как ваши дела? Сначала уточню вашу задачу, затем покажу находки по сайту и предложу следующий шаг.`, [], 'callIntroComment', { 'Если не знает': '«Спасибо, что нашли время. Начнем с вашей задачи».', 'Если заинтересован': '«Отлично, рад слышать».', 'Если возражает': '«Понимаю. Спасибо, что нашли время».', }),
		step('discovery', 'Задача', [], values.seoGoal ? 'Вашу задачу уже записал. Уточню то, что мы еще не обсудили.' : 'Чтобы показать полезное именно для вас, уточню пару вещей.', [
			question('seoGoal', 'Какую задачу хотите решить с помощью SEO?'),
			question('priorityCategories', 'Какие товары, услуги и регионы сейчас в приоритете?'),
			question('currentSeo', 'Кто сейчас занимается SEO? Результат устраивает?'),
			question('currentSources', 'Откуда сейчас приходят заявки?', { optional: true }),
			question('currentLeads', 'Отслеживаете, сколько заявок приходит из поиска?', { optional: true }),
		], 'callDiscoveryComment'),
		step('positions', 'Позиции', [2], positions, [question('callQueryRelevance', 'Насколько эти направления важны для ваших продаж?')], 'callDataComment', { 'Если возражает': '«Понял. Не будем брать этот запрос за основу. Выберем ваше приоритетное направление».', 'Если вопрос технический': '«Это сохраненный замер. Причины позиции уточним при проверке страницы».', }),
		step('competitors', 'Конкуренты', [3, 4], 'Посмотрим на сайты выше по этим запросам. Сравним, как у них устроены разделы и страницы товаров. Полезные решения можно рассмотреть и для вашего сайта.', [question('callCompetitorFinding', 'Какие из показанных конкурентов вам знакомы?')], 'callComparisonComment', { 'Если возражает': '«Если это не прямой конкурент, не будем брать его за ориентир».', 'Если вопрос технический': '«Одно отличие не объясняет всю позицию. Причины проверит SEO-специалист».', }),
		step('potential', 'Потенциал', [5], 'Здесь пример расчета заявок. Проценты условные: это не прогноз и не ваши подтвержденные потери. Для точного расчета нужны данные вашего сайта.', [question('desiredResult', 'Какой результат от SEO был бы для вас полезен?')], 'callPotentialComment', { 'Если возражает': '«Согласен, без ваших конверсий точную цифру назвать нельзя. Здесь только пример расчета».', }),
		step('skyseo', 'SkySEO', [6, 7, 8], 'Здесь пример теста другого проекта: по отдельным запросам позиции изменились. SEO, правки и тексты ведет одна команда со своими программистами. Опыт специалиста с 2004 года; продвижение в нейросетях входит в SEO без доплаты.', [question('callInterest', 'Насколько такой подход вам подходит?')], 'callSkyseoComment', { 'Если сомневается': '«Что нужно увидеть, чтобы вам было проще принять решение?»', 'Если возражает': '«Этот кейс показывает один пример. Результат вашего сайта нужно измерить отдельно».', }),
		step('terms', 'Условия', [], 'Чтобы предложить подходящий объем работ, уточню условия.', [
			question('budgetComment', 'Какой ежемесячный бюджет на SEO рассматриваете или пока ждете расчет от нас?'),
			question('callStartAnswer', 'Когда готовы начать?'),
			question('decisionMaker', 'Кто вместе с вами принимает решение?'),
			question('vendorCriteria', 'Что важно при выборе подрядчика?'),
		], 'callTermsComment', { 'Если возражает': '«Стоимость зависит от сайта и задач. Вернусь с расчетом после оценки специалиста».', }),
		step('test', 'Тест', [9], 'Сначала покажем, что умеем. Потом обсудим сотрудничество. Если специалист подтвердит, что тест подходит вашему проекту, подберем запросы, проведем пять дней бесплатного продвижения и покажем динамику позиций.', [question('callTestDecision', 'Хотели бы попробовать такой тест?'), question('callTestDirection', 'Какое направление возьмем в первую очередь?')], 'callTestComment', { 'Если заинтересован': '«Отлично. Уточню применимость теста у SEO-специалиста и согласуем старт».', 'Если сомневается': '«Что смущает перед тестом?»', 'Если возражает': '«Хорошо, тест не обязателен. Можем сначала обсудить план со специалистом».', 'Если вопрос технический': '«За пять дней покажем два замера. Рост заранее обещать не буду».', }),
		step('finish', 'Завершение', [], 'Спасибо за разговор. Зафиксируем договоренности и следующий контакт.', [
			question('objection', 'Что еще нужно уточнить перед решением?', { optional: true }),
			question('nextStep', 'Какой следующий шаг вам удобнее?'),
			question('followUpAt', 'Когда удобно вернуться к обсуждению?', { kind: 'datetime' }),
		], 'callClosingComment', { 'Если заинтересован': '«Договорились. Вернусь к вам в согласованное время».', 'Если возражает': '«Понял, спасибо за прямой ответ. Зафиксирую ваше решение».', }),
	] }
}
