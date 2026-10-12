import 'reflect-metadata'
import { strict as assert } from 'node:assert'
import { writeFileSync } from 'node:fs'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { buildCallScript } from '../crm/call-script'
import { renderCallScriptHtml } from '../crm/call-script.pdf'
import { UpdateLeadDto } from '../crm/dto'
import { renderCallPresentationHtml } from '../report/call-presentation.template'
import { renderPdf } from '../report/report.pdf'

async function main() {
	const brief = { domain: 'example.ru', keywords: [
		{ keyword: 'товар купить', position: 3, competitors: [{ domain: 'competitor.ru', position: 1 }] },
		{ keyword: 'ремонт оборудования', position: 28, competitors: [{ domain: 'competitor.ru', position: 5 }] },
	] }
	const context = { id: 'recipient-test', firstName: 'Иван', middleName: 'Иванович', domain: 'example.ru', crmLead: { budgetMin: 50000, decisionMaker: 'Иван', qualification: { seoGoal: 'Больше заявок', priorityCategories: 'Оборудование', hasSeo: 'NO', vendorCriteriaCodes: ['CASES'], callDataComment: 'Ранняя заметка' }, tasks: [{ kind: 'FOLLOW_UP', dueAt: '2026-11-01T10:00:00.000Z', followUpRecipientId: 'other-recipient' }] } }
	const script = buildCallScript(context, brief)
	assert.equal(script.steps.length, 9)
	assert.deepEqual(script.steps.map(step => step.slides), [[1], [], [2], [3, 4], [5], [6, 7, 8], [], [9], []])
	assert.equal(script.steps[1].questions[0].known, true)
	assert.equal(script.steps[1].questions[2].answer, 'SEO пока нет')
	assert.equal(script.steps[6].questions[0].known, true)
	assert.equal(script.steps[6].questions[2].known, true)
	assert.equal(script.steps[6].questions[3].answer, 'Кейсы')
	assert.equal(script.steps[7].questions[1].answer, 'Оборудование', 'known priorities must also prefill the test direction')
	assert.equal(script.steps[2].comment, 'Ранняя заметка')
	assert.equal(script.steps[8].questions.find(question => question.key === 'followUpAt')?.known, false, 'another recipient follow-up must not hide this question')
	assert.ok(script.steps[2].say.includes('3-м месте') && script.steps[2].say.includes('28-е'))
	assert.ok(script.steps[4].say.includes('не прогноз'))
	assert.ok(script.steps[7].say.includes('Если специалист подтвердит'))
	assert.ok(script.steps.every(step => Object.keys(step.hints).length === 5))
	const empty = buildCallScript({}, null)
	assert.ok(empty.steps[2].say.includes('пока не могу назвать позиции'))
	assert.ok(!buildCallScript({ company: 'СКБ-4' }, null).steps[0].say.includes('Здравствуйте, СКБ-4'))
	const patch = plainToInstance(UpdateLeadDto, { qualification: { callComparisonComment: 'Сравнение', callPotentialComment: 'Потенциал', callInterest: 'Интересно', callSkyseoComment: 'Команда', callClosingComment: 'Перезвонить', callCompletedAt: '2026-10-12T15:00:00.000Z' } })
	assert.deepEqual(await validate(patch, { whitelist: true, forbidNonWhitelisted: true }), [], 'new answers must pass the actual CRM DTO')
	const html = renderCallScriptHtml(buildCallScript({ firstName: '<img src=x>', domain: 'example.ru' }, null))
	assert.ok(html.includes('&lt;img src=x&gt;'))
	assert.equal((html.match(/<section class="page">/g) || []).length, 3)
	const presentation = renderCallPresentationHtml({ ...brief, companyName: 'Тестовая компания', addressee: null, generatedAt: new Date(), region: 'Москва', measuredAt: new Date('2026-10-12'), keywords: brief.keywords.map(keyword => ({ ...keyword, volume: null, competitors: keyword.competitors.map(other => ({ ...other, url: 'https://competitor.ru/catalog' })) })) })
	assert.equal((presentation.match(/<section class="slide">/g) || []).length, 9)
	assert.ok(presentation.includes('60+ примеров работ') && presentation.includes('Сначала покажем'))
	assert.ok(!presentation.includes('undefined'))
	writeFileSync('/private/tmp/skyseo-call-script-fixture.json', JSON.stringify({ ...context, crmLead: { ...context.crmLead, id: 'crm-test' }, script }))
	writeFileSync('/private/tmp/skyseo-call-script-fixture.html', renderCallScriptHtml(script))
	if (process.argv.includes('--pdf')) {
		writeFileSync('/private/tmp/skyseo-call-script-demo.pdf', await renderPdf(renderCallScriptHtml(script), true))
		writeFileSync('/private/tmp/skyseo-call-presentation-demo.pdf', await renderPdf(presentation))
	}
	console.log('Call script: nine stages, slide mapping, known CRM answers, legacy comments, truthful data, recipient-specific follow-up, safe PDF HTML and DTO validation passed.')
}
void main().catch(error => { console.error(error); process.exitCode = 1 })
