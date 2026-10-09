import { strict as assert } from 'node:assert'
import { containsDomainOrUrl, domainName } from '../common/domain'
import { buildOutreachMessage } from '../outreach/outreach-message'
import { fillTemplate } from '../tg-warmup/campaign-text'
import { buildLeadVars } from '../tg-warmup/lead-vars'

assert.equal(domainName('https://www.shop.example.co.uk/catalog'), 'example')
assert.equal(domainName('shop.example.ru'), 'example')
assert.equal(domainName('xn--e1afmkfd.xn--p1ai'), 'пример')

const keywords = [{ keyword: 'станки купить', position: 19 }]
const competitors = [{ domain: 'shop.rival.ru', position: 9 }, { domain: 'other.co.uk', position: 10 }]
const vars = buildLeadVars(keywords, competitors)
assert.equal(vars['конкуренты'], 'rival и other')
assert.equal(vars['конкурент'], 'rival')

const recipient = { firstName: 'Михаил', middleName: 'Михайлович', domain: 'client.ru', leadVars: vars }
const first = fillTemplate('{фио}, здравствуйте! Посмотрел {сайт}: выше {конкуренты}.', recipient)
assert.equal(first, 'Михаил Михайлович, здравствуйте! Посмотрел client: выше rival и other.')
assert.equal(containsDomainOrUrl(first), false)

// Сохранённые до исправления данные тоже не должны создавать ссылки.
const oldVars = { ...vars, конкурент: 'shop.rival.ru', конкуренты: 'shop.rival.ru и other.co.uk' }
const fromOldVars = fillTemplate('Выше {конкурент} и {конкуренты}', { ...recipient, leadVars: oldVars })
assert.equal(fromOldVars, 'Выше rival и rival и other')
assert.equal(containsDomainOrUrl(fromOldVars), false)

const followUp = buildOutreachMessage({ domain: recipient.domain, firstName: recipient.firstName, middleName: recipient.middleName, keywords, competitors })
assert.match(followUp, /выше вас rival и other/)
assert.equal(containsDomainOrUrl(followUp), false)

for (const text of ['client.ru', 'https://client.ru', 'www.client.com', 'shop.client.co.uk', 'client@shop.ru', 'сайт.рф']) {
	assert.equal(containsDomainOrUrl(text), true, text)
}
assert.equal(containsDomainOrUrl('Посмотрел client, выше rival. Позиция 10.5.'), false)
console.log('Telegram outreach domain checks passed')
