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
.cover .heading { height: 40mm; margin-top: 11mm; }
.cover h1 { margin-top: 0; }
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
  color: #44464f; font-size: 8.9pt; font-weight: 700; line-height: 1.25;
}
.takeaway::before {
  content: ''; position: absolute; top: 3.6mm; left: 0;
  width: 2.3mm; height: 2.3mm; border-radius: .5mm; background: var(--blue);
}
.dark .takeaway { color: #f4f4f5; }
footer {
  position: absolute; bottom: 5mm; left: 16mm; right: 16mm;
  display: flex; justify-content: space-between;
  color: #797b84; font-size: 7pt;
}
.dark footer { color: #aeb0b8; }

/* Cover: bespoke illustration based on the website's squares and star. */
.cover-grid { display: grid; grid-template-columns: 1.25fr 1fr; gap: 5mm; height: 79mm; align-items: center; }
.cover-main { display: flex; flex-direction: column; align-items: flex-start; }
.cover-domain {
  max-width: 160mm; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--subtle); font-size: 10pt; font-weight: 700;
}
.cover-main p { max-width: 135mm; margin: 5mm 0 0; font-size: 12.8pt; line-height: 1.3; }
.cover-tags { display: flex; flex-wrap: wrap; gap: 2mm; margin-top: 7mm; }
.cover-tags span {
  border-radius: 10mm; background: #d7d8dc; color: #35363d;
  padding: 1.9mm 3mm; font-size: 8.1pt; font-weight: 700;
}
.cover-note { margin-top: 6mm; font-size: 9pt; color: var(--subtle); }
.cover-art { display: block; width: 112%; height: 94mm; object-fit: contain; transform: translate(-2mm, -15mm); }

/* Qualification and decision. */
.final-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8mm; height: 61mm; }
.final-card {
  padding: 4mm 1mm 3mm;
  background: transparent;
}
.final-card h2 { margin: 1.5mm 0 3mm; font-size: 18pt; line-height: 1.1; }
.final-card p { max-width: 106mm; margin: 0 0 3mm; font-size: 10.7pt; line-height: 1.36; }
.shape { color: var(--blue); font-size: 18pt; line-height: 1; }
.shape.square { color: #555861; }
.question {
  margin-top: 5mm; padding: 3.5mm 5mm;
  border-left: 1mm solid var(--blue); border-radius: 0 2mm 2mm 0;
  background: #dfe0e4; color: var(--ink);
  font-size: 13pt; font-weight: 700;
}
.decision-compare { display: grid; grid-template-columns: 1fr 1fr; gap: 5mm; height: 55mm; }
.decision-card { display: flex; flex-direction: column; padding: 5mm 6mm; border-radius: 3mm; background: var(--panel); }
.decision-card:nth-child(2) { background: #dcdee3; }
.decision-card span { color: var(--subtle); font-size: 9pt; font-weight: 700; }
.decision-card strong { margin: 2mm 0 0; color: var(--blue); font-size: 29pt; line-height: 1; }
.decision-card b { margin-top: auto; font-size: 13pt; line-height: 1.17; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.decision-caption { margin-top: 3mm; color: var(--subtle); font-size: 9pt; }
.decision-compare + .decision-caption + .question { margin-top: 4mm; }

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

/* Position plot for the three queries discussed on the call. */
.business-point {
  display: flex; align-items: center; gap: 5mm;
  margin-top: 4mm; padding: 3mm 5mm; min-height: 23mm;
  border-radius: 3mm; background: #dfe0e4;
}
.business-point svg { width: 12mm; height: 12mm; }
.business-point p { margin: 0; font-size: 10pt; line-height: 1.3; }
.rank-plot { padding: 5mm 6mm; border-radius: 3mm; background: var(--panel); }
.rank-axis { display: flex; justify-content: space-between; padding-left: 88mm; padding-right: 13mm; margin-bottom: 5mm; color: var(--subtle); font-size: 8pt; }
.rank-line { display: grid; grid-template-columns: 82mm 1fr 9mm; gap: 6mm; align-items: center; height: 15mm; }
.rank-line > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10pt; font-weight: 700; }
.rank-line > b { color: var(--blue); font-size: 21pt; text-align: right; }
.rank-track { position: relative; height: 3mm; border-radius: 2mm; background: #d9dae0; }
.rank-first { display: block; height: 100%; border-radius: 2mm; background: #b2b3fb; }
.rank-dot { position: absolute; top: 50%; width: 5mm; height: 5mm; transform: translate(-50%, -50%); border: 1mm solid var(--blue); border-radius: 50%; background: var(--panel); }
.rank-empty { padding: 5mm; color: var(--subtle); }
.rank-plot + .business-point { min-height: 14mm; margin-top: 4mm; }
.rank-plot + .business-point svg { width: 8mm; height: 8mm; }

/* Search result evidence. */
.empty { padding: 5mm; border-radius: 3mm; background: var(--panel); font-size: 10pt; line-height: 1.4; }
.compare-query { margin-bottom: 4mm; font-size: 11pt; }
.versus-grid { display: grid; grid-template-columns: 1.55fr 1fr; gap: 6mm; height: 64mm; }
.versus-rivals, .versus-mine { padding: 5mm; border-radius: 3mm; background: var(--panel); }
.versus-rivals > span, .versus-mine > span { display: block; margin-bottom: 3mm; color: var(--subtle); font-size: 9pt; font-weight: 700; }
.versus-row { display: grid; grid-template-columns: 12mm 1fr; gap: 4mm; align-items: center; height: 14mm; border-top: .2mm solid #d4d5db; }
.versus-row b { color: #686a74; font-size: 19pt; }
.versus-row strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11pt; }
.versus-mine { display: flex; flex-direction: column; background: #d4d6dc; }
.versus-mine strong { margin: auto 0 0; color: var(--blue); font-size: 51pt; line-height: 1; }
.versus-mine b { margin: 2mm 0 auto; font-size: 12pt; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.compare-foot { margin-top: 3mm; color: var(--subtle); font-size: 8.5pt; }

/* Query map. */
.query-columns { display: grid; grid-template-columns: 1fr 1fr; gap: 6mm; }
.query-column { min-height: 76mm; padding: 4mm 5mm; border-radius: 3mm; background: var(--panel); }
.query-column:nth-child(2) { background: #dfe0e4; }
.query-column-head { display: flex; justify-content: space-between; align-items: center; height: 11mm; margin-bottom: 2mm; }
.query-column-head strong { font-size: 13pt; }
.query-column-head b { color: var(--blue); font-size: 23pt; }
.query-chip { display: grid; grid-template-columns: 1fr 9mm; gap: 2mm; align-items: center; height: 11mm; border-top: .2mm solid #c9cad0; }
.query-chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 9pt; }
.query-chip b { text-align: right; font-size: 13pt; }
.query-overflow { margin-top: 3mm; color: var(--subtle); font-size: 8pt; }

/* Known positions versus unknown business outcome. */
.opportunity-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 5mm; height: 49mm; }
.opportunity-grid > div { display: flex; flex-direction: column; padding: 5mm 6mm; border-radius: 3mm; background: var(--panel); }
.opportunity-unknown { background: #dfe0e4 !important; }
.opportunity-grid span { color: var(--subtle); font-size: 9pt; font-weight: 700; }
.opportunity-grid strong { margin: 2mm 0 0; color: var(--blue); font-size: 32pt; line-height: 1; }
.opportunity-grid b { margin-top: auto; font-size: 12pt; }
.data-flow { display: grid; grid-template-columns: 1fr 8mm 1fr 8mm 1fr; gap: 2mm; align-items: center; margin-top: 5mm; height: 23mm; }
.data-flow > div { display: flex; flex-direction: column; justify-content: center; height: 100%; padding: 3mm 4mm; border-radius: 2mm; background: #d6d8dd; }
.data-flow b { font-size: 12pt; }
.data-flow span { margin-top: 1mm; color: var(--subtle); font-size: 8pt; }
.data-flow i { text-align: center; color: #777983; font-size: 18pt; font-style: normal; }

/* Five-day process. */
.days-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4mm; height: 43mm; }
.days-grid > div { padding: 4mm 4mm 3mm; background: var(--panel); }
.days-grid b { font-size: 14pt; color: var(--ink); }
.days-grid small { display: block; margin-bottom: 2mm; color: var(--subtle); font-size: 8pt; font-weight: 700; }
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
