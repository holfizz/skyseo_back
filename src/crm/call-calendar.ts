/** RFC 5545 calendar for a private, read-only call subscription. */

export const CALL_REMINDER_OFFSETS = [24 * 60, 2 * 60, 60] as const

export function callReminderRows(taskId: string, dueAt: Date, now = new Date()) {
	return CALL_REMINDER_OFFSETS.map(offsetMinutes => ({
		taskId,
		remindAt: new Date(dueAt.getTime() - offsetMinutes * 60_000),
		offsetLabel: offsetMinutes === 1440 ? 'за сутки' : `за ${offsetMinutes / 60} ч.`,
	})).filter(row => row.remindAt > now)
}

type CalendarCall = {
	id: string
	title: string
	description: string | null
	dueAt: Date | null
	createdAt: Date
	updatedAt: Date
}

function escapeText(value: string) {
	return value.replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;')
}

function fold(value: string) {
	const rows: string[] = []
	let row = ''
	for (const char of value) {
		if (Buffer.byteLength(row + char, 'utf8') > 75) {
			rows.push(row)
			row = ' ' + char
		} else row += char
	}
	rows.push(row)
	return rows.join('\r\n')
}

function stamp(date: Date) {
	return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

export function renderCallCalendar(calls: CalendarCall[]) {
	const lines = [
		'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SkySEO//CRM Calls//RU',
		'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:SkySEO - созвоны',
		'REFRESH-INTERVAL;VALUE=DURATION:PT15M', 'X-PUBLISHED-TTL:PT15M',
	]
	for (const call of calls) {
		if (!call.dueAt) continue
		lines.push(
			'BEGIN:VEVENT',
			`UID:crm-call-${call.id}@skyseo.site`,
			`DTSTAMP:${stamp(call.updatedAt)}`,
			`CREATED:${stamp(call.createdAt)}`,
			`LAST-MODIFIED:${stamp(call.updatedAt)}`,
			`SEQUENCE:${Math.floor(call.updatedAt.getTime() / 1000)}`,
			`DTSTART:${stamp(call.dueAt)}`,
			`DTEND:${stamp(new Date(call.dueAt.getTime() + 30 * 60_000))}`,
			`SUMMARY:${escapeText(call.title)}`,
			`DESCRIPTION:${escapeText(call.description || 'Созвон из SkySEO CRM')}`,
			'STATUS:CONFIRMED',
		)
		for (const duration of ['P1D', 'PT2H', 'PT1H']) lines.push(
			'BEGIN:VALARM', `TRIGGER:-${duration}`, 'ACTION:DISPLAY',
			`DESCRIPTION:${escapeText(call.title)}`, 'END:VALARM',
		)
		lines.push('END:VEVENT')
	}
	lines.push('END:VCALENDAR')
	return lines.map(fold).join('\r\n') + '\r\n'
}
