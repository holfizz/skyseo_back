// The old report download and the call deck share one client-facing design.
import { renderCallPresentationHtml } from './call-presentation.template'
import { ReportData } from './report.types'
export { C, FONT_BOLD_B64, FONT_REGULAR_B64, LOGO_SVG_B64 } from './report.assets'

export function renderReportHtml(data: ReportData): string {
 return renderCallPresentationHtml(data)
}
