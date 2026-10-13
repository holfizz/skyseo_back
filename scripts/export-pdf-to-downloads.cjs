const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const [input, filename] = process.argv.slice(2)
if (!input) throw new Error('usage: node export-pdf-to-downloads.cjs source.pdf [filename.pdf]')
const source = path.resolve(input)
if (path.extname(source).toLowerCase() !== '.pdf') throw new Error('Expected a PDF source')
const pdf = fs.readFileSync(source)
if (!pdf.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error('Invalid PDF source')

const now = new Date()
const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
const name = (filename || `${path.basename(source, path.extname(source))}_${today}.pdf`)
  .replace(/_\d{4}-\d{2}-\d{2}(?=\.pdf$)/i, `_${today}`)
if (path.basename(name) !== name || path.extname(name).toLowerCase() !== '.pdf') throw new Error('Expected a PDF filename without directories')

const downloads = path.join(os.homedir(), 'Downloads')
const target = path.join(downloads, name)
if (source === target) throw new Error('Export from the project PDF, not its Downloads copy')

// Write only the bytes: metadata-copy APIs can backdate creation on macOS.
const staging = fs.mkdtempSync(path.join(downloads, '.skyseo-pdf-'))
try {
  const fresh = path.join(staging, name)
  fs.writeFileSync(fresh, pdf, { flag: 'wx' })
  fs.utimesSync(fresh, now, now)
  fs.renameSync(fresh, target)
  process.stdout.write(`${target}\n`)
} finally {
  fs.rmSync(staging, { recursive: true, force: true })
}
