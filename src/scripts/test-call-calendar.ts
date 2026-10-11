import { strict as assert } from 'node:assert'
import { callReminderRows, renderCallCalendar } from '../crm/call-calendar'

const dueAt = new Date('2026-10-20T12:00:00.000Z')
const now = new Date('2026-10-19T10:00:00.000Z')
assert.deepEqual(callReminderRows('call-1', dueAt, now).map(row => row.remindAt.toISOString()), [
	'2026-10-19T12:00:00.000Z', '2026-10-20T10:00:00.000Z', '2026-10-20T11:00:00.000Z',
])
assert.deepEqual(callReminderRows('call-1', dueAt, new Date('2026-10-20T10:30:00.000Z')).map(row => row.offsetLabel), ['за 1 ч.'])

const title = 'Созвон: длинное название клиента с кириллицей, запятой, и другим текстом'
const ics = renderCallCalendar([{ id: 'call-1', title, description: 'План; бюджет\nследующий шаг', dueAt, createdAt: now, updatedAt: now }])
assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'))
assert.match(ics, /DTSTART:20261020T120000Z\r\n/)
assert.match(ics, /DTEND:20261020T123000Z\r\n/)
assert.match(ics, /UID:crm-call-call-1@skyseo\.site/)
assert.deepEqual([...ics.matchAll(/TRIGGER:-(P1D|PT2H|PT1H)/g)].map(match => match[1]), ['P1D', 'PT2H', 'PT1H'])
assert.match(ics.replace(/\r\n /g, ''), /DESCRIPTION:План\\; бюджет\\nследующий шаг/)
assert.ok(ics.split('\r\n').every(line => Buffer.byteLength(line, 'utf8') <= 75))
assert.ok(ics.endsWith('END:VCALENDAR\r\n'))
console.log('CRM call calendar checks passed')
