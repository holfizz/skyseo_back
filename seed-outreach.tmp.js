// Тестовый прогон парсера: правдоподобная выдача + лиды с реквизитами.
// Данные фиктивные, домены вымышленные — ничего живого не трогаем.
const { PrismaClient } = require('@prisma/client')
const p = new PrismaClient()

const QUERY = 'купить голден гус'
const KEYS = ['купить голден гус', 'голден гус москва', 'голден гус оригинал', 'кроссовки golden goose цена']

// топ-10 — «конкуренты», ниже — потенциальные лиды
const TOP = ['lamoda.ru','wildberries.ru','tsum.ru','farfetch.com','brandshop.ru','aizel.ru','kixbox.ru','sneakerhead.ru','shoes-premium.ru','italy-style.ru']
const LEADS = [
  { d:'gg-boutique.ru',   name:'ООО «ДжиДжи Бутик»',  inn:'7707083893', ogrn:'1027700132195', city:'Москва',
    fio:['Дмитрий','Журавлев','Сергеевич'], tg:'gg_boutique', ph:['+74951234567'], em:['info@gg-boutique.ru'] },
  { d:'sneaker-loft.ru',  name:'ИП Соколова А. В.',    inn:'504214972068', ogrnip:'307503823500056', city:'Химки',
    fio:['Анна','Соколова',null], tg:'sneakerloft', ph:['+79161112233'], em:['shop@sneaker-loft.ru'] },
  { d:'italystore.ru',    name:'ООО «Италия Стор»',    inn:'7325124756', ogrn:'1137325006796', city:'Санкт-Петербург',
    fio:['Игорь','Панов','Валентинович'], tg:null, ph:['+78129998877','+79219998877'], em:['sale@italystore.ru'] },
  { d:'premium-shoes.ru', name:null,                    inn:null, city:null,
    fio:[null,null,null], tg:'premshoes', ph:[], em:['mail@premium-shoes.ru'] },
  { d:'moda-outlet.ru',   name:'ИП Крылов М. Д.',      inn:'212810656614', ogrnip:'314213016200017', city:'Казань',
    fio:['Максим','Крылов','Дмитриевич'], tg:'modaoutlet', ph:['+78432223344'], em:[] },
]

const rows = []
for (const kw of KEYS) {
  TOP.forEach((d, i) => rows.push({ keyword: kw, position: i + 1, domain: d, url: `https://${d}/catalog`, title: `${d} — ${kw}` }))
  // каждый лид встречается не по всем ключам — так реалистичнее
  LEADS.forEach((l, i) => {
    if ((i + KEYS.indexOf(kw)) % 4 === 3) return
    const pos = 12 + ((i * 7 + KEYS.indexOf(kw) * 5) % 34)
    rows.push({ keyword: kw, position: pos, domain: l.d, url: `https://${l.d}/`, title: `${l.name ?? l.d} — ${kw}`,
      contacts: { emails: l.em, phones: l.ph, telegram: l.tg ? ['@' + l.tg] : [],
                  whatsapp: [], inn: l.inn ? [l.inn] : [], ogrn: l.ogrn ? [l.ogrn] : [], ogrnip: l.ogrnip ? [l.ogrnip] : [] } })
  })
}

;(async () => {
  const payload = { query: QUERY, region: 'Москва', positionMin: 11, positionMax: 50, rows }
  require('fs').writeFileSync('/tmp/import.json', JSON.stringify(payload, null, 1))
  console.log('import.json:', rows.length, 'строк,', (require('fs').statSync('/tmp/import.json').size/1024).toFixed(0), 'КБ')

  // ФИО парсер не отдаёт — заполняются руками в админке, проставим для наглядности
  const byDomain = Object.fromEntries(LEADS.map(l => [l.d, l]))
  await p.$disconnect()
  console.log('\nдальше: загрузить /tmp/import.json через админку либо curl с токеном')
  console.log('ФИО для ручного заполнения:', Object.entries(byDomain).filter(([,l])=>l.fio[0]).map(([d,l])=>`${d}: ${l.fio[1]} ${l.fio[0]} ${l.fio[2]??''}`).join(' | '))
})()
