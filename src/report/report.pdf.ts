import { ServiceUnavailableException } from '@nestjs/common'

// puppeteer в package.json НЕТ. Модуль обязан компилироваться и без него,
// поэтому грузим через require с вычисляемым именем — иначе tsc пытается
// разрешить модуль на этапе сборки и падает с TS2307.
function loadPuppeteer(): any {
	// Сначала полный puppeteer (со своим Chromium), потом puppeteer-core.
	// Стоит core: он весит 3 МБ вместо 200 и работает с браузером, который
	// уже есть в системе. Имена вычисляемые — иначе tsc падает с TS2307.
	for (const id of ['puppeteer', 'puppeteer-core']) {
		try {
			const mod = require(id)
			return mod?.default ?? mod
		} catch {
			/* пробуем следующий */
		}
	}
	throw new ServiceUnavailableException(
		'PDF недоступен: не установлен ни puppeteer, ни puppeteer-core. ' +
			'HTML-версия отчёта доступна по той же ссылке без /pdf.',
	)
}

// puppeteer-core своего браузера не несёт — путь обязателен. Берём из env,
// иначе ищем среди обычных мест установки. Полный puppeteer это переживёт:
// у него executablePath просто перекроет встроенный Chromium.
function resolveChrome(): string | undefined {
	if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH
	const fs = require('fs')
	const candidates = [
		'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
		'/Applications/Chromium.app/Contents/MacOS/Chromium',
		'/usr/bin/chromium-browser',
		'/usr/bin/chromium',
		'/usr/bin/google-chrome',
	]
	return candidates.find(p => { try { return fs.existsSync(p) } catch { return false } })
}

export async function renderPdf(html: string): Promise<Buffer> {
	const puppeteer = loadPuppeteer()
	// В Alpine-образе штатный Chromium из puppeteer не запускается (musl),
	// там ставится системный chromium и путь к нему передаётся через env.
	const browser = await puppeteer.launch({
		headless: true,
		executablePath: resolveChrome(),
		args: ['--no-sandbox', '--disable-dev-shm-usage'],
	})
	try {
		const page = await browser.newPage()
		await page.setContent(html, { waitUntil: 'load' })
		const pdf = await page.pdf({
			format: 'A4',
			printBackground: true,
			margin: { top: '14mm', right: '12mm', bottom: '14mm', left: '12mm' },
		})
		return Buffer.from(pdf)
	} finally {
		await browser.close()
	}
}
