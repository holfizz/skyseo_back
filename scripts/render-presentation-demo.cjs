// Локальный макет для проверки верстки. Домен, запросы и конкуренты вымышлены.
const fs = require('node:fs')
const path = require('node:path')
const { renderReportHtml } = require('../dist/src/report/report.template')
const { renderPdf } = require('../dist/src/report/report.pdf')

const names = [
	'заказать промышленное оборудование', 'производство деталей на заказ',
	'поставка оборудования для завода', 'ремонт промышленного оборудования',
	'запчасти для станков', 'станки оптом', 'сервис оборудования', 'оборудование для цеха',
]
const positions = [3, 8, 12, 16, 24, 31, 39, 47]
const volumes = [350, 240, 480, 680, 400, 320, null, 520]
const keywords = names.map((keyword, i) => ({
	keyword, position: positions[i], volume: volumes[i],
	competitors: Array.from({ length: Math.min(10, positions[i] - 1) }, (_, j) => {
		const domain = `competitor${(j + i) % 10 + 1}.example`
		return { position: j + 1, domain, url: `https://${domain}` }
	}),
}))
const data = {
	domain: 'demo.example', companyName: 'Демо-компания', addressee: null,
	keywords, region: 'Москва', measuredAt: new Date('2026-09-28'),
	generatedAt: new Date(),
}

renderPdf(renderReportHtml(data)).then(pdf => {
	const out = path.join(__dirname, '..', 'docs', 'SEO_PRESENTATION_DEMO.pdf')
	fs.writeFileSync(out, pdf)
	process.stdout.write(`${out}\n`)
}).catch(error => {
	process.stderr.write(`${error}\n`)
	process.exitCode = 1
})
