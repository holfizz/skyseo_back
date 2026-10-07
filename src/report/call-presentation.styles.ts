import { FONT_BOLD_B64, FONT_REGULAR_B64 } from './report.assets'

// Print-first design. Neutral surfaces carry the information; blue is reserved
// for a few numbers and rules that need attention during a screen-shared call.
export const CALL_PRESENTATION_CSS = `
@font-face { font-family: Helio; src: url(data:font/ttf;base64,${FONT_REGULAR_B64}); }
@font-face { font-family: Helio; src: url(data:font/ttf;base64,${FONT_BOLD_B64}); font-weight: 700; }
@page { size: 297mm 167mm; margin: 0; }

:root {
  --ink: #222329;
  --subtle: #62646d;
  --paper: #ececef;
  --panel: #f8f8f9;
  --panel-mid: #dedfe3;
  --line: #c9cad0;
  --blue: #1400ff;
}
* { box-sizing: border-box; }
html, body {
  margin: 0; padding: 0;
  font-family: Helio, Arial, sans-serif;
  color: var(--ink);
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.slide {
  position: relative;
  width: 297mm; height: 167mm;
  overflow: hidden;
  padding: 10mm 16mm 12mm;
  background: var(--paper);
  page-break-after: always;
}
.slide:last-child { page-break-after: auto; }
.slide.dark { background: #292a30; color: #f8f8f9; }
header {
  height: 9mm;
  display: flex; align-items: center; justify-content: space-between;
  color: var(--subtle); font-size: 8pt;
}
.brand { display: flex; align-items: center; gap: 2mm; color: var(--ink); font-size: 11pt; }
.brand img { width: 7mm; height: 7mm; }
.dark header { color: #b9bac1; }
.dark .brand { color: #fff; }
.dark .brand img { filter: grayscale(1) brightness(0) invert(1); }
.heading { height: 39mm; margin-top: 5mm; }
.eyebrow {
  display: inline-flex; align-items: center; gap: 2mm;
  padding: 1.4mm 3mm; border-radius: 8mm;
  background: #d8d9de; color: #32333a;
  font-size: 8.5pt; font-weight: 700;
}
.eyebrow::before { content: ''; width: 1.7mm; height: 1.7mm; border-radius: .5mm; background: var(--blue); }
.dark .eyebrow { background: #44464f; color: #f6f6f7; }
h1 { margin: 2.2mm 0 0; font-size: 28pt; line-height: 1.05; letter-spacing: -.035em; }
h1 em { color: inherit; font-style: normal; }
.dark h1 { color: #f8f8f9; }
.body { height: 88mm; position: relative; }
.takeaway {
  position: absolute; bottom: 10.8mm; left: 16mm; right: 16mm;
  min-height: 11mm; padding: 3.3mm 0 0 6mm;
  border-top: .35mm solid var(--line);
  color: #44464f; font-size: 8.9pt; font-weight: 700; line-height: 1.25;
}
.takeaway::before {
  content: ''; position: absolute; top: 3.6mm; left: 0;
  width: 2.3mm; height: 2.3mm; border-radius: .5mm; background: var(--blue);
}
.dark .takeaway { border-top-color: #555761; color: #f4f4f5; }
footer {
  position: absolute; bottom: 5mm; left: 16mm; right: 16mm;
  display: flex; justify-content: space-between;
  color: #797b84; font-size: 7pt;
}
.dark footer { color: #aeb0b8; }

/* Cover: real site and measured distribution, without a fake browser frame. */
.cover-grid { display: grid; grid-template-columns: 1.45fr .75fr; gap: 7mm; height: 76mm; }
.cover-main { display: flex; flex-direction: column; align-items: flex-start; }
.cover-domain {
  max-width: 160mm; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  padding: 0 0 2.5mm; border-bottom: .5mm solid #9fa1aa;
  color: var(--subtle); font-size: 11pt; font-weight: 700;
}
.cover-main p { max-width: 160mm; margin: 5mm 0 0; font-size: 13.3pt; line-height: 1.32; }
.cover-tags { display: flex; flex-wrap: wrap; gap: 2mm; margin-top: auto; padding-bottom: 2mm; }
.cover-tags span {
  border: .3mm solid #cbccd2; border-radius: 10mm;
  background: #dedfe3; color: #35363d;
  padding: 1.9mm 3mm; font-size: 8.1pt; font-weight: 700;
}
.cover-graphic {
  display: flex; flex-direction: column;
  padding: 7mm; border-radius: 4mm; background: #dfe0e4;
}
.cover-graphic .graphic-label { font-size: 9pt; font-weight: 700; color: var(--subtle); }
.cover-graphic .graphic-count { display: flex; align-items: baseline; gap: 2mm; margin: auto 0 2mm; }
.cover-graphic strong { font-size: 49pt; line-height: .9; color: var(--ink); }
.cover-graphic .graphic-count span { font-size: 19pt; color: #757781; }
.cover-graphic .graphic-track { height: 3.3mm; border-radius: 2mm; background: #bfc0c8; overflow: hidden; }
.cover-graphic .graphic-track i { display: block; height: 100%; border-radius: 2mm; background: var(--blue); }
.cover-graphic small { margin-top: 4mm; font-size: 9pt; line-height: 1.3; color: #43454d; }

/* Qualification and decision: rules instead of identical oversized cards. */
.choice-grid, .final-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8mm; height: 61mm; }
.choice, .final-card {
  padding: 4mm 1mm 3mm; border-top: .5mm solid #92949d;
  background: transparent;
}
.choice h2, .final-card h2 { margin: 1.5mm 0 3mm; font-size: 18pt; line-height: 1.1; }
.choice p, .final-card p { max-width: 106mm; margin: 0 0 3mm; font-size: 10.7pt; line-height: 1.36; }
.shape { color: var(--blue); font-size: 18pt; line-height: 1; }
.shape.square { color: #555861; }
.question {
  margin-top: 5mm; padding: 3.5mm 5mm;
  border-left: 1mm solid var(--blue); border-radius: 0 2mm 2mm 0;
  background: #dfe0e4; color: var(--ink);
  font-size: 13pt; font-weight: 700;
}

/* Position overview: a measured distribution, not three decorative KPI tiles. */
.position-map { height: 52mm; padding: 5mm 6mm; border-radius: 3mm; background: var(--panel); }
.position-caption { display: flex; justify-content: space-between; margin-bottom: 4mm; font-size: 9pt; color: var(--subtle); }
.position-caption b { color: var(--ink); }
.position-row { display: grid; grid-template-columns: 45mm 1fr 12mm; gap: 5mm; align-items: center; margin: 3.2mm 0; }
.position-row b { font-size: 10pt; }
.position-row strong { font-size: 16pt; text-align: right; }
.position-track { height: 6mm; background: #e0e1e5; border-radius: 1.5mm; overflow: hidden; }
.position-track i { display: block; height: 100%; min-width: 0; border-radius: 1.5mm; background: #b1b3bc; }
.position-track i.first { background: var(--blue); }
.position-track i.middle { background: #777984; }
.position-track i.deep { background: #b1b3bc; }
.bracket {
  display: flex; align-items: center; gap: 5mm;
  margin-top: 5mm; padding: 3mm 4mm;
  background: #dfe0e4; border-radius: 0 3mm 3mm 0;
}
.brace {
  height: 15mm; width: 3mm; flex: none;
  border-left: .7mm solid #858791; border-top: .7mm solid #858791; border-bottom: .7mm solid #858791;
}
.bracket p { margin: 0; font-size: 10.5pt; line-height: 1.3; }

/* Commercial queries: three useful rows, with no decorative empty boxes. */
.hot-grid { display: grid; gap: 2mm; height: 55mm; }
.hot {
  display: grid; grid-template-columns: 1fr 22mm 35mm; gap: 5mm;
  align-items: center; min-height: 16mm;
  padding: 2mm 5mm; border-radius: 2.5mm; background: var(--panel);
}
.hot span { font-size: 12pt; font-weight: 700; line-height: 1.2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hot strong { color: var(--blue); font-size: 24pt; line-height: 1; text-align: right; }
.hot small { color: var(--subtle); font-size: 8pt; line-height: 1.2; }
.business-point {
  display: flex; align-items: center; gap: 5mm;
  margin-top: 4mm; padding: 3mm 5mm; min-height: 23mm;
  border-radius: 3mm; background: #dfe0e4;
}
.business-point svg { width: 12mm; height: 12mm; }
.business-point p { margin: 0; font-size: 10pt; line-height: 1.3; }

/* Search result evidence. */
.rivals-grid { display: grid; grid-template-columns: 1.45fr .85fr; gap: 6mm; }
.serp-label { margin: 0 0 2mm; font-size: 10pt; font-weight: 700; color: var(--ink); }
.serp-row {
  display: grid; grid-template-columns: 9mm 1fr 30mm; gap: 3mm; align-items: center;
  min-height: 7mm; margin: 1.5mm 0; padding: 1.4mm 3mm;
  border-radius: 2mm; background: var(--panel); font-size: 9pt;
}
.serp-row b { color: var(--blue); }
.serp-row span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.serp-row small { color: var(--subtle); text-align: right; }
.serp-row.mine { background: #ccced5; font-weight: 700; }
.rivals-side {
  display: flex; flex-direction: column; justify-content: center;
  padding: 5mm; border-radius: 3mm; background: #dfe0e4;
}
.rivals-side svg { width: 14mm; height: 14mm; }
.rivals-side h2 { margin: 2mm 0 3mm; font-size: 15pt; line-height: 1.2; }
.rivals-side p { margin: 0; font-size: 9.5pt; line-height: 1.35; }
.empty { padding: 5mm; border-radius: 3mm; background: var(--panel); font-size: 10pt; line-height: 1.4; }

/* Full query list. */
.query-head, .query-row { display: grid; grid-template-columns: 1fr 18mm 43mm; gap: 3mm; align-items: center; padding: 1mm 4mm; }
.query-head { border-radius: 2mm; background: #d1d2d8; color: var(--ink); font-size: 8pt; font-weight: 700; }
.query-row { min-height: 5.9mm; border-bottom: .2mm solid #d1d2d8; font-size: 8.4pt; }
.query-row span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.query-row b { color: var(--ink); font-size: 11pt; }
.query-row small { color: var(--subtle); font-size: 7.7pt; }
.query-list { margin-top: 1mm; }

/* Opportunity calculation. */
.equation { display: grid; grid-template-columns: 1fr 8mm 1fr 8mm 1fr; gap: 3mm; height: 46mm; }
.equation > div {
  display: flex; flex-direction: column; justify-content: center;
  padding: 5mm; border-radius: 3mm; background: var(--panel);
  border-top: .5mm solid #a3a5ae;
}
.equation b { font-size: 15pt; color: var(--ink); }
.equation span { margin-top: 2mm; font-size: 9pt; line-height: 1.3; }
.equation i { align-self: center; text-align: center; font-size: 22pt; font-style: normal; color: #797b84; }
.range {
  display: flex; align-items: center; gap: 7mm;
  margin-top: 5mm; padding: 4mm 6mm; min-height: 29mm;
  border-radius: 3mm; background: #d9dade;
}
.range strong { color: var(--blue); font-size: 28pt; }
.range b { font-size: 10pt; white-space: nowrap; }
.range p { margin: 0; font-size: 10pt; line-height: 1.35; }

/* Five-day process. */
.days-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4mm; height: 43mm; }
.days-grid > div { padding: 4mm 4mm 3mm; border-top: .5mm solid #9fa1aa; background: var(--panel); }
.days-grid b { font-size: 14pt; color: var(--ink); }
.days-grid p { margin: 2mm 0 0; font-size: 9.5pt; line-height: 1.3; }
.test-compare { display: grid; grid-template-columns: 1fr 12mm 1fr; gap: 3mm; align-items: center; margin-top: 5mm; height: 31mm; }
.test-compare > div {
  display: flex; align-items: center; gap: 5mm; height: 100%;
  padding: 3mm 5mm; border-radius: 3mm; background: #d9dade;
}
.test-compare > div:last-child { background: #e4e5e8; }
.test-compare span { font-size: 9pt; }
.test-compare b { color: var(--blue); font-size: 23pt; white-space: nowrap; }
.test-compare small { max-width: 38mm; margin-left: auto; font-size: 8pt; }
.test-compare i { text-align: center; font-size: 23pt; font-style: normal; color: #787a83; }

/* Last slide: charcoal, not another blue screen. */
.dark .final-card { padding: 5mm; border: 0; border-radius: 3mm; background: #383a43; color: #f8f8f9; }
.dark .final-card.accent { background: #494b55; }
.dark .shape { color: #aeb5ff; }
.dark .shape.square { color: #d8d9df; }
.dark .question { background: #383a43; color: #f8f8f9; }
`
