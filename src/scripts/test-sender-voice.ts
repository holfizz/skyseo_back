import { strict as assert } from 'node:assert'
import { senderVoice, hasSenderGender } from '../tg-warmup/sender-voice'
import { maySend } from '../tg-warmup/campaign.service'
import { fillTemplate } from '../tg-warmup/campaign-text'
import { containsDomainOrUrl } from '../common/domain'

const sample = '{фио}, добрый день.\n\nСмотрел {сайт} в поиске. По вашему сайту уже посмотрел позиции.\n\nА вообще хотел пообщаться. Посмотрел ваши позиции, заметил возможности. Могу показать, что нашёл.'
const female = senderVoice(sample,'FEMALE')!
assert.ok(female.includes('Смотрела {сайт}'))
assert.ok(female.includes('уже посмотрела'))
assert.ok(female.includes('вообще хотела'))
assert.ok(female.includes('заметила возможности'))
assert.ok(female.includes('что нашла'))
assert.ok(!/(?:смотрел|посмотрел|заметил|хотел|нашёл)(?![а-я])/iu.test(female))
assert.equal(senderVoice(female,'MALE'),sample.replace('нашёл','нашел'))
assert.equal(senderVoice(sample,'UNSPECIFIED'),null)
assert.equal(senderVoice('Могу с вами пообщаться?', 'UNSPECIFIED'),'Могу с вами пообщаться?')
assert.equal(senderVoice('Ваш подрядчик посмотрел сайт. Владелец нашел ошибку.', 'FEMALE'),'Ваш подрядчик посмотрел сайт. Владелец нашел ошибку.')
assert.equal(senderVoice('Посмотрел запрос «Смотрел, нашел».', 'FEMALE'),'Посмотрела запрос «Смотрел, нашел».')
assert.equal(senderVoice('РАД вашему ответу! Я уже проверил сайт.', 'FEMALE'),'РАДА вашему ответу! Я уже проверила сайт.')
const rendered=fillTemplate(senderVoice('Смотрел {сайт}. По «{запрос}» вы на {позиция} месте.', 'FEMALE')!,{domain:'shop.example.ru',leadVars:{запрос:'смотрел нашел',позиция:'15'}})
assert.equal(rendered,'Смотрела example. По «смотрел нашел» вы на 15 месте.')
assert.equal(containsDomainOrUrl(rendered),false)
for(const gender of ['MALE','FEMALE']) assert.equal(maySend({gender},{allowOutgoing:true}),true)
for(const gender of ['UNSPECIFIED',undefined,'female']) assert.equal(maySend({gender},{allowOutgoing:true}),false)
assert.equal(maySend({gender:'FEMALE'},{allowOutgoing:false}),false,'Gender never overrides Telegram restrictions')
assert.equal(hasSenderGender(null),false)
console.log('Sender voice: female/male wording, default guard, case, quoted queries, lead values, links and send permissions passed')
