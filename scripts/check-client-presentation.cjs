// Structural print QA. This complements (and does not replace) rendered-page review.
const fs = require('node:fs')
const path = require('node:path')
const puppeteer = require('puppeteer-core')
const { resolveChrome } = require('../dist/src/report/report.pdf')
async function main() {
 if (!process.argv[2]) throw new Error('Usage: node scripts/check-client-presentation.cjs presentation.html')
 const browser = await puppeteer.launch({ headless: true, executablePath: resolveChrome(), args: ['--no-sandbox'] })
 try {
  const page = await browser.newPage()
  await page.setContent(fs.readFileSync(path.resolve(process.argv[2]), 'utf8'), { waitUntil: 'load' })
  await page.evaluate(() => document.fonts.ready)
  const report = await page.evaluate(() => {
   const failures = []
   for (const image of document.images) if (!image.complete || !image.naturalWidth) failures.push({ image: image.alt || 'unnamed', error: 'image failed' })
   const slides = [...document.querySelectorAll('.slide')]
   for (const slide of slides) {
    const id = slide.dataset.slideId, body = slide.querySelector('.slide-body'), box = body.getBoundingClientRect()
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT)
    let node
    while ((node = walker.nextNode())) {
     if (!node.textContent.trim()) continue
     const range = document.createRange(); range.selectNodeContents(node)
     const rect = range.getBoundingClientRect()
     if (rect.width && (rect.bottom > box.bottom + 3 || rect.top < box.top - 3 || rect.left < box.left - 3 || rect.right > box.right + 3)) {
      failures.push({ id, text: node.textContent.trim().slice(0, 80), error: 'text outside content area' })
     }
    }
    for (const row of slide.querySelectorAll('.keyword-row,.topic-card,.position-row,.comparison-summary')) {
     if (row.scrollHeight > row.clientHeight + 2 || row.scrollWidth > row.clientWidth + 2) failures.push({ id, text: row.textContent.slice(0, 60), error: 'card overflow' })
    }
    const title = slide.querySelector('.slide-title')
    if (title.scrollHeight > title.clientHeight + 2) failures.push({ id, error: 'title overflow' })
   }
   return { slides: slides.length, images: document.images.length, failures }
  })
  console.log(JSON.stringify(report, null, 2))
  if (report.failures.length) process.exitCode = 1
 } finally { await browser.close() }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
