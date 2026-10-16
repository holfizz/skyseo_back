import { strict as assert } from 'node:assert'
import { hasActivePremium, parsePremiumUntil } from '../tg-warmup/premium'
import { outgoingAllowance } from '../tg-warmup/warmup-plan'

const now = new Date('2026-10-16T14:00:00Z')
const known = { probe: { premium: true }, premiumCheckedAt: new Date('2026-09-01T00:00:00Z') }
assert.equal(hasActivePremium(known, now), true, 'Known Premium does not expire after 24 hours')
assert.equal(hasActivePremium({ ...known, premiumUntil: parsePremiumUntil('2026-10-16') }, now), true)
const deadline = parsePremiumUntil('2026-10-16')!
assert.equal(deadline.toISOString(), '2026-10-16T21:00:00.000Z', 'Last paid date is inclusive in Moscow')
assert.equal(hasActivePremium({ ...known, premiumUntil: deadline }, new Date(deadline.getTime() - 1)), true)
assert.equal(hasActivePremium({ ...known, premiumUntil: deadline }, deadline), false, 'No grace period past the paid date')
assert.equal(hasActivePremium({ ...known, probe: { premium: false }, premiumUntil: parsePremiumUntil('2026-12-01') }, now), false)
assert.equal(hasActivePremium({ probe: { premium: true } }, now), false, 'Still require one actual confirmation')
assert.equal(parsePremiumUntil(null), null)
assert.equal(parsePremiumUntil('2028-02-29')!.toISOString(), '2028-02-29T21:00:00.000Z')
for (const value of [undefined, '', '2026-02-29', '2026-02-30', '2026-13-01', '2026-00-01', '16.10.2026', '2026-10-16T00:00:00Z']) assert.throws(() => parsePremiumUntil(value))
const input = { premium:true, dayIndex:0, ageDays:100, daysManaged:3, actionsTotal:0, dialogs:0, channels:0, profileFilled:1, spamBlock:'clean' as const, floodWaits:0, peerFloods:0 }
assert.equal(outgoingAllowance(input).allowOutgoing, true)
assert.equal(outgoingAllowance({ ...input, premiumExpired:true }).allowOutgoing, false)
assert.equal(outgoingAllowance({ ...input, spamBlock:'temporary' }).allowOutgoing, false)
assert.equal(outgoingAllowance({ ...input, peerFloods:2 }).allowOutgoing, false)
assert.equal(outgoingAllowance({ ...input, daysManaged:0 }).allowOutgoing, false)
console.log('Premium: persistent confirmation, exact Moscow deadline, invalid dates, initial proof and Telegram restrictions passed')
