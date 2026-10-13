import type { Research, DeckSlide } from './preparation/types'
import { scenarioRows } from '../report/call-presentation.template'
export type CallQuestion = { key: string; text: string; answer: string; known: boolean; kind?: 'datetime'; optional?: boolean; choices?: Array<{label:string;value:string}>; when?: {key:string;values:string[]} }
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
function buildBaseCallScript(context: Context, brief: Brief | null): CallScript {
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

export function buildCallScript(context:Context,brief:Brief|null,prepared?:{research:Research;slides:DeckSlide[]}):CallScript {
 if(!prepared)return buildBaseCallScript(context,brief)
 const {research,slides}=prepared
 const base=buildBaseCallScript(context,{domain:research.domain,keywords:research.keywords.map(k=>({...k,competitors:k.top10}))})
 const values=context.crmLead?.qualification as Record<string,unknown>||{}
 const old=(id:string)=>base.steps.find(s=>s.id===id)!
 const q=(key:string,text:string,extra:Partial<CallQuestion>={}):CallQuestion=>{
  const existing=base.steps.flatMap(s=>s.questions).find(q=>q.key===key)
  const answer=existing?.answer||String(values[key]||'')
  return {key,text,answer,known:!!answer,...extra}
 }
 const choices=(entries:string[][])=>entries.map(([value,label])=>({value,label}))
 const step=(id:string,title:string,say:string,questions:CallQuestion[],commentKey:string,slideId?:string,hints?:Record<string,string>):CallStep=>({id,title,say,questions,commentKey,comment:String(values[commentKey]||''),slides:slideId?[slides.findIndex(s=>s.id===slideId)+1]:[],hints:{...old('discovery').hints,'Если сомневается':'«Понимаю. А что именно вызывает сомнения?»','Если вопрос технический':'«Хороший вопрос. Не хочу давать неточный ответ. Уточню у SEO-специалиста и вернусь с конкретикой».','Если хочет подумать':'«Конечно. Направлю презентацию и договоримся, когда будет удобно вернуться к обсуждению».',...hints}})
 const greeting=[context.firstName,context.middleName].filter(Boolean).join(' ')
 const statements=[research.keywords.some(k=>k.measuredAt&&!k.error)?'посмотрел позиции в Яндексе':null,research.comparisons.length?'сравнил с конкурентами':null].filter(Boolean).join(', ')
 const hasSeo=q('hasSeo','SEO у вас сейчас кто-нибудь занимается?',{choices:choices([['YES','Да'],['NO','Нет'],['UNKNOWN','Не знаю']])})
 if(!hasSeo.known&&String(values.currentSeo||'')){hasSeo.known=true;hasSeo.answer=String(values.currentSeo)}
 const provider=q('seoProvider','Кто занимается SEO?',{choices:choices([['AGENCY','Агентство'],['IN_HOUSE','В штате'],['FREELANCER','Фрилансер'],['UNKNOWN','Не знаю']]),when:{key:'hasSeo',values:['YES']}})
 const satisfaction=q('seoSatisfied','А насколько вас устраивают текущие результаты?',{choices:choices([['YES','Устраивают'],['PARTIAL','Частично'],['NO','Не устраивают'],['UNKNOWN','Не знаю']]),when:{key:'hasSeo',values:['YES']}})
 if(values.currentSeo){provider.known=true;satisfaction.known=true}
 const steps=[step('hello','Знакомство',`${greeting?greeting+', здравствуйте!':'Здравствуйте!'} Как у вас дела?\n\nСмотрите, я подготовил небольшой разбор вашего сайта.${statements?' Я '+statements+' и нашел несколько интересных моментов.':''} Но сначала хотел бы пару вещей уточнить.`,[],'callIntroComment','cover'),step('discovery','Перед презентацией','Чтобы разбор был полезен для ваших задач, уточню пару вещей.',[hasSeo,provider,satisfaction,q('seoGoal','Какая у вас сейчас основная задача: больше заявок или продвижение конкретных направлений?'),q('priorityCategories','Какие товары, услуги или регионы сейчас в приоритете?')],'callDiscoveryComment',undefined,{'Если заинтересован':'«Понял вас. Тогда давайте покажу, что удалось найти».','Если уже есть агентство':'«Понял. А насколько вас устраивают текущие результаты?»'})]
 for(const slide of slides){
  if(slide.kind==='POSITIONS'){
   const measured=research.keywords.filter(k=>!k.error&&k.measuredAt),ranked=measured.filter(k=>k.position!==null).sort((a,b)=>a.position!-b.position!)
   const strong=ranked.filter(k=>k.position!<=10).slice(0,2),growth=ranked.filter(k=>k.position!>10).slice(0,2)
   const positions=(rows:typeof ranked)=>rows.map(k=>`по запросу «${k.keyword}» — ${k.position}-е место`).join(', ')
   const start=strong.length?`Смотрите, начнем с хорошего. ${positions(strong).replace(/^по/,'По')}.`:ranked.length?`Смотрите, вот измеренные позиции: ${positions(ranked.slice(0,2))}.`:`В проверенной выдаче сайт по этим запросам не найден. Глубина проверки указана на слайде.`
   steps.push(step('positions','Позиции',start+'\n\n'+(strong.length&&growth.length?`Есть и направления ниже топ-10: ${positions(growth)}. `:'')+'Интересно понять, какие товары важны для продаж и какие запросы стоит усиливать в первую очередь.',[q('callQueryRelevance','Эти направления сейчас актуальны для ваших продаж?')],'callDataComment',slide.id))
  }
  if(slide.kind==='COMPARISON'){
   const comp=research.comparisons.find(c=>c.id===slide.comparisonId)!
   const own=comp.clientPosition?`ваш сайт на ${comp.clientPosition}-м месте`:`ваш сайт не найден в проверенном топ-${comp.scanned}`
   const action=comp.feature==='Параметры оборудования'?comp.apply.replace(/^Дополнить страницу: /,'Можно добавить ')+'. Так страница будет отвечать на более точные поисковые запросы.':'Можно проверить спрос по этим направлениям и выделить отдельные страницы под нужные запросы.'
   const ours=comp.feature==='Параметры оборудования'&&!/[,]/.test(comp.clientFinding)?`У вас есть страница «${comp.clientFinding}».`:`У вас представлены ${comp.clientFinding.toLowerCase()}.`
   const say=`Теперь давайте посмотрим на конкурента. По запросу «${comp.keyword}» ${own}, а ${comp.competitor.domain} — на ${comp.competitor.position}-м.\n\nНа странице конкурента есть ${comp.competitorFinding.toLowerCase()}. ${ours}\n\n${action}`
   const number=research.comparisons.indexOf(comp)
   steps.push(step(comp.id,'Сравнение страниц',say,number===0?[q('callCompetitorFinding','Какие из этих решений были бы полезны для ваших направлений?')]:[],number===0?'callComparisonComment':'callComparisonSecondComment',slide.id))
  }
  if(slide.kind==='POTENTIAL'){
   const row=scenarioRows(research)[0],volume=row.volume!.toLocaleString('ru-RU'),leads=(row.volume!*.06*.03).toLocaleString('ru-RU',{maximumFractionDigits:1})
   steps.push(step('potential','Поисковый спрос',`Здесь я посмотрел не только позиции, но и поисковый спрос. По запросу «${row.keyword}» в Wordstat — ${volume}.\n\nПри условных 6% переходов и 3% конверсии получается около ${leads} заявок. Это математический пример, не прогноз для вашего бизнеса. Для реалистичного расчета нужна ваша аналитика.`,[q('currentLeads','Вы сейчас знаете, сколько заявок приходит именно из поиска Яндекса?')],'callPotentialComment',slide.id))
  }
  if(slide.kind==='CASE')steps.push(step('case','Пример работы','Теперь покажу пример работы нашего специалиста. Вот проект по заборам: за пять дней по двум запросам позиции изменились с 12-го на третье и с 21-го на шестое место.\n\nЭто конкретный пример из замеров, а не обещание такого же результата на любом сайте.',[],'callCaseComment',slide.id))
  if(slide.kind==='ADVANTAGES')steps.push(step('advantages','О SkySEO','Теперь буквально пару слов о нас. Мы предлагаем SEO под ключ: работу с запросами, текстами и техническими изменениями на сайте.\n\nУ нашего специалиста опыт в SEO с 2004 года. Также работаем с присутствием компании в нейросетях в составе SEO. Состав работ заранее согласуем.',[],'callSkyseoComment',slide.id))
  if(slide.kind==='PORTFOLIO')steps.push(step('portfolio','Примеры работ','Вот еще примеры работ в разных нишах. По вашему проекту отдельно выберем приоритетные страницы и способ измерения результата.',[],'callPortfolioComment',slide.id))
 }
 steps.push(step('terms','После презентации','Вот такой небольшой разбор получился. Подскажите, как вам в целом то, что я показал?',[q('callInterest','Видите для себя интерес в дальнейшем продвижении?',{choices:choices([['Интересно','Интересно'],['Есть сомнения','Есть сомнения'],['Не актуально','Не актуально']])}),...old('terms').questions],'callTermsComment',undefined,{'Если не знает':'«Ничего страшного. Сначала подготовим предложение по объему работ, а стоимость обсудим отдельно».','Если заинтересован':'«Отлично. Тогда давайте согласуем следующий шаг».'}))
 const next=slides.find(s=>s.kind==='NEXT')!
 const testSay=research.trial==='CONFIRMED'?'Смотрите, мы можем сначала провести бесплатный тест на вашем сайте. За пять дней выберем согласованные запросы, проведем тестовые работы и покажем замеры до и после.\n\nВы посмотрите, что получилось, и уже после этого обсудим сотрудничество.':research.trial==='UNAVAILABLE'?'Для вашего проекта сначала подготовим индивидуальный план. Специалист оценит сайт и предложит приоритеты, объем работ и способ измерения результата.':'Предлагаю передать ваш сайт SEO-специалисту. Он оценит задачи и проверит, подходит ли бесплатный пятидневный тест.\n\nПосле этого предложим тест с замерами до и после или индивидуальный план.'
 steps.push(step('test','Следующий шаг',testSay,[q('callTestDecision','Как вам такой формат?',{choices:choices([['Интересно','Подходит'],['Нужно подумать','Нужно подумать'],['Не интересно','Не подходит']])})],'callTestComment',next.id))
 steps.push({...old('finish'),say:'Спасибо за разговор. Тогда зафиксируем договоренности и согласуем, когда вернемся к обсуждению.',hints:{...old('finish').hints,'Если хочет подумать':'«Конечно. Направлю презентацию, а мы договоримся о следующем контакте».'}})
 const followUp=steps.at(-1)?.questions.find(q=>q.key==='followUpAt')
 if(followUp?.answer && new Date(followUp.answer)<=new Date()) followUp.known=false
 return {name:greeting||research.companyName||base.name,site:research.domain,steps}
}
