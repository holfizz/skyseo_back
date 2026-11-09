// Rebuild only the design from existing evidence. No database, API or new measurements.
const fs = require('node:fs')
const path = require('node:path')
const { buildSlideOutline, renderResearchPresentation } = require('../dist/src/report/call-presentation.template')
const { buildCallScript } = require('../dist/src/crm/call-script')
const { renderCallScriptHtml } = require('../dist/src/crm/call-script.pdf')
const { renderPdf } = require('../dist/src/report/report.pdf')
const option = name => { const i = process.argv.indexOf('--' + name); return i >= 0 ? process.argv[i + 1] : undefined }

async function main() {
 if (!option('research') || !option('out')) throw new Error('Usage: node scripts/render-saved-client-call.cjs --research path/research.json --out output-directory')
 const source = path.resolve(option('research')), directory = path.resolve(option('out'))
 if (directory === path.dirname(source)) throw new Error('Use a new output directory to preserve the previous client PDF')
 const saved = JSON.parse(fs.readFileSync(source, 'utf8')), research = saved.research || saved
 if (research.version !== 1 || !research.domain || !Array.isArray(research.keywords) || !research.region) throw new Error('Expected saved Research v1')
 fs.mkdirSync(directory, { recursive: true })
 const slides = buildSlideOutline(research)
 const script = buildCallScript({ company: research.companyName, domain: research.domain }, null, { research, slides })
 const client = renderResearchPresentation(research, slides), notes = renderCallScriptHtml(script)
 fs.writeFileSync(path.join(directory, 'CLIENT_PRESENTATION.html'), client)
 fs.writeFileSync(path.join(directory, 'CALL_SCRIPT.html'), notes)
 fs.writeFileSync(path.join(directory, 'slides.json'), JSON.stringify(slides, null, 2))
 fs.writeFileSync(path.join(directory, 'call-script.json'), JSON.stringify(script, null, 2))
 fs.writeFileSync(path.join(directory, 'CLIENT_PRESENTATION.pdf'), await renderPdf(client))
 fs.writeFileSync(path.join(directory, 'CALL_SCRIPT.pdf'), await renderPdf(notes, true))
 fs.writeFileSync(path.join(directory, 'provenance.json'), JSON.stringify({ source, renderedAt: new Date().toISOString(), newMeasurements: false, slides: slides.length }, null, 2))
 console.log(JSON.stringify({ directory, slides: slides.length, keywords: research.keywords.length, measured: research.keywords.filter(k => k.measuredAt && !k.error && k.scanned > 0).length }))
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
