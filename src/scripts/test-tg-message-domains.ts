import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { containsDomainOrUrl, domainName } from '../common/domain'
import { buildOutreachMessage } from '../outreach/outreach-message'
import { adaptTopTenClaim, fillTemplate, missingPlaceholders } from '../tg-warmup/campaign-text'
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

// H5's manually sent continuation must use real saved positions and stripped
// competitor names. Missing data disables the suggestion instead of inventing it.
const h5Sql = readFileSync(join(__dirname, '../../prisma/migrations/20261011160000_h5_approved_second_message/migration.sql'), 'utf8')
const h5Template = h5Sql.match(/\$approved\$([\s\S]*?)\$approved\$/)?.[1]
assert.ok(h5Template)
assert.deepEqual(missingPlaceholders(h5Template, recipient), [])
assert.deepEqual(missingPlaceholders(h5Template, { ...recipient, leadVars: {} }), ['запрос', 'позиция', 'конкуренты'])
const h5Second = fillTemplate(adaptTopTenClaim(h5Template, recipient), recipient)
assert.match(h5Second, /по «станки купить» сайт на 19 месте, но до топ-10 пока не дотягивает/)
assert.match(h5Second, /Среди конкурентов в выдаче вижу rival и other/)
assert.match(h5Second, /вопросам\.\n\nДавайте созвонимся/)
assert.equal(/[—–Ёё]/.test(h5Second), false)
assert.equal(containsDomainOrUrl(h5Second), false)
const topTenRecipient = { ...recipient, leadVars: { ...vars, позиция: '10' } }
const topTenSecond = fillTemplate(adaptTopTenClaim(h5Template, topTenRecipient), topTenRecipient)
assert.match(topTenSecond, /сайт на 10 месте и уже входит в топ-10/)
assert.equal(topTenSecond.includes('не дотягивает'), false)
assert.equal(containsDomainOrUrl(topTenSecond), false)

for (const text of ['client.ru', 'https://client.ru', 'www.client.com', 'shop.client.co.uk', 'client@shop.ru', 'сайт.рф']) {
	assert.equal(containsDomainOrUrl(text), true, text)
}
assert.equal(containsDomainOrUrl('Посмотрел client, выше rival. Позиция 10.5.'), false)
console.log('Telegram outreach domain checks passed')
