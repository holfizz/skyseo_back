// Поднимаем Nest-контекст, чтобы получить настоящий HTML тем же кодом, что и PDF
const { NestFactory } = require('@nestjs/core')
const { AppModule } = require('./dist/src/app.module.js')
const { ReportService } = require('./dist/src/report/report.service.js')
;(async () => {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false })
  const svc = app.get(ReportService)
  const { PrismaClient } = require('@prisma/client'); const p = new PrismaClient()
  const lead = await p.outreachLead.findFirst({ where: { domain: 'gg-boutique.ru' }, select: { id: true } })
  const html = await (svc.html ? svc.html(lead.id) : svc.renderHtml(lead.id))
  require('fs').writeFileSync('/tmp/report.html', html)
  console.log('HTML сохранён:', (html.length/1024).toFixed(0), 'КБ')
  await p.$disconnect(); await app.close(); process.exit(0)
})().catch(e => { console.log('методы:', Object.getOwnPropertyNames(Object.getPrototypeOf(require('./dist/src/report/report.service.js').ReportService.prototype))); console.error(e.message) })
