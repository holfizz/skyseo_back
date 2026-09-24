import { C, FONT_BOLD_B64, FONT_REGULAR_B64, LOGO_SVG_B64 } from './report.template'

/**
 * Портфолио кейсов SkySEO — горизонтальные слайды на светло-сером фоне.
 * Не продающий буклет, а подборка работ: избранные кейсы с разбором
 * (тезис → проблема → решение → результат) и галерея всех проектов со скринами
 * выдачи из портфолио на fl.ru. Фигуры-узоры (те же, что на странице услуг) —
 * как ненавязчивый декор нашими акцентными цветами.
 *
 * Данные: у двух проектов есть замеры Топвизора (реальные позиции), у остальных
 * — факт «в топ-10 Яндекса» из портфолио. Разбор проблемы/решения написан по
 * нише; конкретных цифр, которых нет в замерах, не выдумываем.
 *
 * Картинки — карта base64 (ключ → jpeg): 'zerkalo'/'pribor' — Топвизор,
 * 'big08'… — избранные скрины выдачи, 'th00'… — превью для галереи.
 */

type Featured = {
	domain: string
	niche: string
	img: string
	imgCaption: string
	thesis: string
	problem: string
	solution: string
	result: string
}

const FEATURED: Featured[] = [
	{
		domain: 'зеркало-стекло.рф', niche: 'Производство стекла и зеркал', img: 'zerkalo',
		imgCaption: 'Динамика позиций в Топвизоре · Яндекс, Москва',
		thesis: 'Производителя стекла подняли с 2–3 страницы в топ по коммерции',
		problem: '684 запроса в проекте, но заявки-генерящая коммерция висела ниже первой страницы — её просто не видели.',
		solution: 'Собрали семантику под изделия, перестроили структуру под спрос, нарастили поведенческие сигналы.',
		result: '«стекольный завод в москве» 86 → 2, десятки запросов в топ-1 (замеры Топвизора).',
	},
	{
		domain: 'pribor-r.ru', niche: 'Газоанализаторы и течеискатели', img: 'pribor',
		imgCaption: 'Динамика позиций в Топвизоре · Яндекс, Москва',
		thesis: 'Держим топ-3 в конкурентной нише приборов',
		problem: 'Узкий B2B-спрос, наверху — сильные производители и агрегаторы.',
		solution: 'Точная семантика по товарам и постоянная работа над стабильностью позиций.',
		result: '5 запросов на 1 месте, 10 из 14 в топ-3, 12 из 14 на первой странице.',
	},
	{
		domain: 'klinmetiz.ru', niche: 'Метизный завод · Московская область', img: 'big52',
		imgCaption: 'Выдача Яндекса по коммерческому запросу',
		thesis: 'Завод металлоизделий — в топ-10 по коммерции',
		problem: 'B2B-производство с узкой номенклатурой, наверху — маркетплейсы и агрегаторы.',
		solution: 'Структура под номенклатуру, тексты под профильные запросы, ссылки и поведение.',
		result: 'ТОП-10 Яндекса по ключевым запросам, Московская область.',
	},
	{
		domain: 'indelica.ru', niche: 'Центр косметологии · Самара', img: 'big48',
		imgCaption: 'Выдача Яндекса по услуге в своём городе',
		thesis: 'Клиника косметологии — топ-10 в своём городе',
		problem: 'Медицина под особым контролем Яндекса, плотная локальная конкуренция за пациента.',
		solution: 'Страницы под услуги и методики, тексты под требования медтематики, локальное SEO.',
		result: 'ТОП-10 Яндекса, Самара — по услугам и процедурам.',
	},
	{
		domain: 'fabrikaokon.ru', niche: 'Установка окон · Москва и область', img: 'big08',
		imgCaption: 'Выдача Яндекса по услуге',
		thesis: 'Оконная компания — топ-10 по Москве и области',
		problem: 'Сезонная высококонкурентная ниша с дорогим контекстом.',
		solution: 'Семантика по услугам и гео, посадочные под районы, поведенческие сигналы.',
		result: 'ТОП-10 по установке окон и остеклению балконов.',
	},
	{
		domain: 'eko-tec.ru', niche: 'Флокулянты · промышленная химия', img: 'big23',
		imgCaption: 'Выдача Яндекса по профильному запросу',
		thesis: 'Промышленная химия — топ-10 в узкой B2B-нише',
		problem: 'Очень узкий спрос, покупатель — инженер, а не частник.',
		solution: 'Точные технические запросы, экспертный контент, чистая структура сайта.',
		result: 'ТОП-10 Яндекса по профильным запросам.',
	},
]

// Галерея — проекты портфолио (fl.ru), новые сверху. i — индекс превью (th<i>).
const GALLERY: Array<{ i: string; t: string }> = [
	{ i: '00', t: 'Доставка грузов' }, { i: '01', t: 'Удалённая работа' }, { i: '02', t: 'Горящие туры' },
	{ i: '03', t: 'Кредитные карты' }, { i: '04', t: 'Страхование жизни' }, { i: '05', t: 'Строительство складов' },
	{ i: '06', t: 'Быстровозводимые здания' }, { i: '07', t: 'Mitsubishi Heavy' }, { i: '08', t: 'Установка окон' },
	{ i: '09', t: 'Остекление балконов' }, { i: '10', t: 'Дома из дерева' }, { i: '11', t: 'Пазлы из дерева' },
	{ i: '12', t: 'Предрейсовые осмотры' }, { i: '13', t: 'Перетяжка мебели' }, { i: '15', t: 'Авторские букеты' },
	{ i: '16', t: 'Чугунные лестницы' }, { i: '17', t: 'Манометры Wika' }, { i: '19', t: 'Покраска домов' },
	{ i: '20', t: 'Печи Ферингер' }, { i: '21', t: 'Серийная мебель' }, { i: '22', t: 'Офисные кухни' },
	{ i: '23', t: 'Флокулянты' }, { i: '25', t: 'Картонные коробки' }, { i: '26', t: 'Дорожные блокираторы' },
	{ i: '27', t: 'Картоприёмники' }, { i: '28', t: 'Катера' }, { i: '30', t: 'Газоанализаторы' },
	{ i: '31', t: 'Запчасти для тракторов' }, { i: '32', t: 'Банные печи' }, { i: '33', t: 'Деревянные дома' },
	{ i: '34', t: 'Примерочные' }, { i: '35', t: 'Торговое оборудование' }, { i: '36', t: 'Витрины' },
	{ i: '37', t: 'Раскрой МДФ' }, { i: '38', t: 'Лодки Honda' }, { i: '39', t: 'Моторы Honda' },
	{ i: '41', t: 'Холодильное оборудование' }, { i: '42', t: 'Холодильные компрессоры' }, { i: '43', t: 'Аренда лодок' },
	{ i: '44', t: 'Техника Honda' }, { i: '45', t: 'Кассовые стойки' }, { i: '46', t: 'Банковская мебель' },
	{ i: '47', t: 'Ресепшн на заказ' }, { i: '48', t: 'Центр косметологии' }, { i: '50', t: 'Фракционное омоложение' },
	{ i: '51', t: 'Плацентотерапия' }, { i: '52', t: 'Метизный завод' }, { i: '53', t: 'Печи Прометалл' },
	{ i: '54', t: 'Вентили Вика' }, { i: '55', t: 'Ремонт газоанализаторов' }, { i: '56', t: 'Клееное бревно' },
	{ i: '57', t: 'Насосы' }, { i: '58', t: 'Фанера' }, { i: '59', t: 'Кондиционеры' },
	{ i: '61', t: 'Товары для отдыха' }, { i: '62', t: 'Детейлинг-студия' }, { i: '63', t: 'Автозапчасти Mazda' },
	{ i: '64', t: 'Подержанные авто' }, { i: '65', t: 'Купоны на скидку' }, { i: '66', t: 'Переезды и грузчики' },
	{ i: '68', t: 'Ванны из мрамора' }, { i: '69', t: 'Аренда спецтехники' },
]

// ── фигуры-узоры (те же 4, что на /services) ─────────────────────────────────
function shape(kind: 0 | 1 | 2 | 3, fill: string, style: string): string {
	const body =
		kind === 0
			? `<path fill="${fill}" d="m18.7 4.627l2.247 4.31a2.27 2.27 0 0 0 1.686 1.189l4.746.65c2.538.35 3.522 3.479 1.645 5.219l-3.25 2.999a2.23 2.23 0 0 0-.683 2.04l.793 4.398c.441 2.45-2.108 4.36-4.345 3.24l-4.536-2.25a2.28 2.28 0 0 0-2.006 0l-4.536 2.25c-2.238 1.11-4.786-.79-4.345-3.24l.793-4.399c.14-.75-.12-1.52-.682-2.04l-3.251-2.998c-1.877-1.73-.893-4.87 1.645-5.22l4.746-.65a2.23 2.23 0 0 0 1.686-1.189l2.248-4.309c1.144-2.17 4.264-2.17 5.398 0"/>`
			: kind === 1
				? `<circle cx="16" cy="16" r="14" fill="${fill}"/>`
				: kind === 2
					? `<rect x="2" y="2" width="28" height="28" rx="8" fill="${fill}"/>`
					: `<path fill="${fill}" d="M14.27 5.5a2 2 0 0 1 3.46 0l11.27 19.5a2 2 0 0 1-1.73 3H4.73a2 2 0 0 1-1.73-3z"/>`
	return `<svg class="deco" viewBox="0 0 32 32" style="${style}">${body}</svg>`
}
// акцентные цвета фигур
const SH = { star: '#ffe381', circ: '#c5cbff', sq: '#c9d2ff', tri: '#e2e5ec' }

const ARROW = `<svg class="arw" viewBox="0 0 24 24" fill="none"><path d="M4 12h13.5M12 5.5l6.5 6.5-6.5 6.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`

const esc = (s: string): string =>
	String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const src = (m: Record<string, string>, k: string): string => (m[k] ? `data:image/jpeg;base64,${m[k]}` : '')

function brandBar(): string {
	return `<div class="brand"><img class="brand-mark" src="data:image/svg+xml;base64,${LOGO_SVG_B64}" alt=""><div class="brand-name">SkySEO</div></div>`
}
function foot(label: string, n: number, total: number): string {
	return `<div class="foot"><span>${esc(label)}</span><span>${n} / ${total}</span></div>`
}

function featuredSlide(f: Featured, m: Record<string, string>, n: number, total: number): string {
	return `<div class="slide">
  ${shape(1, SH.circ, 'width:26mm;height:26mm;bottom:20mm;right:-8mm;opacity:.5')}
  ${shape(3, SH.tri, 'width:18mm;height:18mm;bottom:44mm;right:34mm;opacity:.6')}
  <div class="wrap col">
    <div class="row-top">${brandBar()}<div class="kicker">кейс ${String(n - 1).padStart(2, '0')}&nbsp;&nbsp;&nbsp;${esc(f.niche)}</div></div>
    <div class="fx">
      <div class="fx-left">
        <div class="fx-domain">${esc(f.domain)}</div>
        <h2 class="fx-thesis">${esc(f.thesis)}</h2>
        <div class="qa"><div class="qa-l">Проблема</div><div class="qa-t">${esc(f.problem)}</div></div>
        <div class="qa"><div class="qa-l">Что сделали</div><div class="qa-t">${esc(f.solution)}</div></div>
        <div class="qa res"><div class="qa-l">Результат</div><div class="qa-t"><b>${esc(f.result)}</b></div></div>
      </div>
      <div class="fx-right">
        <img class="shot-img" src="${src(m, f.img)}" alt="">
        <div class="shot-cap">${esc(f.imgCaption)}</div>
      </div>
    </div>
    ${foot('SkySEO · портфолио продвижения · ' + f.domain, n, total)}
  </div>
</div>`
}

function gallerySlides(m: Record<string, string>, startPage: number, total: number): string {
	const per = 18
	const chunks: Array<typeof GALLERY> = []
	for (let k = 0; k < GALLERY.length; k += per) chunks.push(GALLERY.slice(k, k + per))
	return chunks
		.map((chunk, ci) => `<div class="slide">
  ${shape(0, SH.star, 'width:22mm;height:22mm;top:8mm;right:-6mm;opacity:.5')}
  <div class="wrap col">
    <div class="row-top">${brandBar()}<div class="kicker">портфолио · выдача Яндекса · ${ci === 0 ? 'новые сверху' : 'продолжение'}</div></div>
    ${ci === 0 ? '<h2 class="gal-h">Ещё проекты в топ-10 Яндекса</h2>' : '<div class="gal-gap"></div>'}
    <div class="gal">
      ${chunk.map(g => `<div class="g"><div class="g-shot"><img src="${src(m, 'th' + g.i)}" alt=""></div><div class="g-t">${esc(g.t)}</div></div>`).join('')}
    </div>
    ${foot('SkySEO · портфолио продвижения', startPage + ci, total)}
  </div>
</div>`)
		.join('\n')
}

export function renderCasesHtml(m: Record<string, string> = {}): string {
	const galleryPages = Math.ceil(GALLERY.length / 18)
	const total = 1 + FEATURED.length + galleryPages + 1
	const featured = FEATURED.map((f, i) => featuredSlide(f, m, i + 2, total)).join('\n')
	const gallery = gallerySlides(m, 2 + FEATURED.length, total)

	return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<title>Портфолио SkySEO</title>
<style>
  @font-face { font-family: 'Helios'; font-weight: 400; src: url(data:font/truetype;base64,${FONT_REGULAR_B64}) format('truetype'); }
  @font-face { font-family: 'Helios'; font-weight: 700; src: url(data:font/truetype;base64,${FONT_BOLD_B64}) format('truetype'); }
  @page { size: 297mm 210mm; margin: 0; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin: 0; background: #ebedf2; color: ${C.dark};
    font-family: 'Helios', -apple-system, "Segoe UI", Roboto, Arial, sans-serif; font-size: 13px; }
  .slide { width: 297mm; height: 210mm; padding: 14mm 16mm; page-break-after: always; position: relative; overflow: hidden; background: #ebedf2; }
  .slide:last-child { page-break-after: auto; }
  .deco { position: absolute; z-index: 0; }
  .wrap { position: relative; z-index: 1; }
  .wrap.col { height: 100%; display: flex; flex-direction: column; }

  .brand { display: flex; align-items: center; gap: 9px; }
  .brand-mark { width: 25px; height: 25px; display: block; }
  .brand-name { font-weight: 800; font-size: 15px; letter-spacing: -0.2px; }
  .row-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
  .kicker { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .7px; color: ${C.periwinkleText}; }
  .arw { width: 18px; height: 18px; display: inline-block; vertical-align: -3px; }
  .foot { margin-top: auto; display: flex; justify-content: space-between; color: ${C.faint}; font-size: 10px;
    border-top: 1px solid ${C.line}; padding-top: 7px; }

  /* Обложка / контакты (серые, с акцентами) */
  .hero { justify-content: center; }
  .hero h1 { font-size: 62px; line-height: 1.04; letter-spacing: -1.7px; font-weight: 800; margin: 22px 0 16px; }
  .hero h1 .hl { background: ${C.yellow}; padding: 0 10px; border-radius: 10px; }
  .hero .sub { font-size: 16.5px; color: ${C.muted}; margin: 0 0 34px; max-width: 195mm; line-height: 1.5; }
  .hero .strip { display: flex; gap: 14px; }
  .hero .st { background: ${C.paper}; border-radius: 20px; padding: 18px 22px; }
  .hero .cn { font-size: 40px; font-weight: 800; letter-spacing: -1.4px; line-height: 1; }
  .hero .cn.blue { color: ${C.blue}; }
  .hero .cl { font-size: 12.5px; color: ${C.muted}; margin-top: 7px; max-width: 48mm; line-height: 1.35; }
  .hero .pill { display: inline-block; background: ${C.yellow}; color: ${C.dark}; font-weight: 800; font-size: 17px; border-radius: 999px; padding: 13px 26px; }
  .hero .site { font-size: 15px; color: ${C.muted}; margin-left: 14px; font-weight: 700; }

  /* Избранный кейс */
  .fx { flex: 1; display: flex; gap: 24px; align-items: stretch; min-height: 0; }
  .fx-left { flex: 0 0 44%; display: flex; flex-direction: column; }
  .fx-domain { font-size: 21px; font-weight: 800; letter-spacing: -0.4px; }
  .fx-thesis { font-size: 26px; line-height: 1.14; letter-spacing: -0.6px; font-weight: 800; margin: 10px 0 18px; }
  .qa { margin-bottom: 13px; }
  .qa-l { font-size: 10.5px; font-weight: 800; text-transform: uppercase; letter-spacing: .6px; color: ${C.faint}; margin-bottom: 3px; }
  .qa-t { font-size: 13.5px; line-height: 1.5; color: ${C.muted}; }
  .qa.res { background: #e6f5ec; border-radius: 14px; padding: 12px 15px; margin-top: auto; }
  .qa.res .qa-l { color: #146c43; } .qa.res .qa-t { color: ${C.dark}; }

  .fx-right { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; min-width: 0; }
  .shot-img { display: block; max-width: 100%; max-height: 132mm; width: auto; height: auto; border-radius: 22px;
    border: 1px solid ${C.line}; background: ${C.paper}; box-shadow: 0 6px 22px rgba(20,20,40,.07); }
  .shot-cap { font-size: 13px; font-weight: 600; color: ${C.muted}; margin-top: 14px; text-align: center; }

  /* Галерея */
  .gal-h { font-size: 26px; font-weight: 800; letter-spacing: -0.5px; margin: 2px 0 12px; }
  .gal-gap { height: 14px; }
  .gal { flex: 1; display: grid; grid-template-columns: repeat(6, 1fr); grid-auto-rows: min-content; gap: 12px 12px; align-content: start; }
  .g { display: flex; flex-direction: column; }
  .g-shot { border-radius: 12px; overflow: hidden; border: 1px solid ${C.line}; background: ${C.paper}; aspect-ratio: 1 / 1; }
  .g-shot img { display: block; width: 100%; height: 100%; object-fit: cover; object-position: top; }
  .g-t { font-size: 10px; font-weight: 700; color: ${C.dark}; margin-top: 5px; line-height: 1.2; }
</style></head><body>

<!-- Обложка -->
<div class="slide">
  ${shape(0, SH.star, 'width:58mm;height:58mm;top:-16mm;right:-10mm;opacity:.7')}
  ${shape(0, SH.circ, 'width:24mm;height:24mm;bottom:22mm;right:28mm;opacity:.6')}
  ${shape(3, SH.sq, 'width:16mm;height:16mm;top:66mm;left:-4mm;opacity:.6')}
  ${shape(3, SH.tri, 'width:20mm;height:20mm;bottom:16mm;left:60mm;opacity:.5')}
  <div class="wrap col hero">
    ${brandBar()}
    <div class="kicker" style="margin-top:14px">портфолио · продвижение сайтов в топ Яндекса</div>
    <h1>Наши кейсы<br>в <span class="hl">топ Яндекса</span></h1>
    <p class="sub">Реальные проекты и позиции из выдачи. Шесть разборов с проблемой, решением и результатом — и галерея проектов, которые вывели в топ-10.</p>
    <div class="strip">
      <div class="st"><div class="cn blue">60+</div><div class="cl">проектов в топ-10 Яндекса</div></div>
      <div class="st"><div class="cn">18 лет</div><div class="cl">специалисты с таким опытом в продвижении</div></div>
      <div class="st"><div class="cn">86 ${ARROW} 2</div><div class="cl">самый дальний запрос — в топ</div></div>
    </div>
    ${foot('SkySEO · портфолио продвижения', 1, total)}
  </div>
</div>

${featured}
${gallery}

<!-- Контакты -->
<div class="slide">
  ${shape(0, SH.star, 'width:50mm;height:50mm;bottom:-14mm;right:-8mm;opacity:.7')}
  ${shape(1, SH.circ, 'width:26mm;height:26mm;top:18mm;right:40mm;opacity:.55')}
  ${shape(2, SH.sq, 'width:20mm;height:20mm;bottom:40mm;left:-6mm;opacity:.5')}
  ${shape(3, SH.tri, 'width:18mm;height:18mm;top:70mm;left:50mm;opacity:.5')}
  <div class="wrap col hero">
    ${brandBar()}
    <div class="kicker" style="margin-top:14px">на связи · первые 5 дней бесплатно</div>
    <h1>Хотите свой сайт<br>в этой <span class="hl">подборке</span>?</h1>
    <p class="sub">Посмотрим ваш сайт, соберём запросы и покажем движение позиций. Первые 5 дней — бесплатно, до любого договора.</p>
    <div><span class="pill">Telegram: @skyseo_support</span><span class="site">skyseo.site</span></div>
    ${foot('SkySEO · продвижение сайтов в топ Яндекса', total, total)}
  </div>
</div>

</body></html>`
}
