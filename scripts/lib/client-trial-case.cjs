// Shared evidence for client decks. Never alter the screenshots or their dates.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const directory = path.join(__dirname, '..', '..', 'docs', 'presentation', 'assets', 'trial-fences')
const evidence = JSON.parse(fs.readFileSync(path.join(directory, 'case.json'), 'utf8'))
if (evidence.screenshots.length !== 2 || evidence.screenshots[0].phase !== 'before' || evidence.screenshots[1].phase !== 'after') {
  throw new Error('Expected one ordered before/after test case')
}
module.exports = {
  ...evidence,
  screenshots: evidence.screenshots.map(record => {
    const bytes = fs.readFileSync(path.join(directory, record.file))
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== record.sha256) {
      throw new Error(`Trial evidence changed: ${record.file}`)
    }
    const [year, month, day] = record.measuredOn.split('-')
    return { ...record, displayDate: `${day}.${month}.${year}`, image: `data:image/png;base64,${bytes.toString('base64')}` }
  }),
}
