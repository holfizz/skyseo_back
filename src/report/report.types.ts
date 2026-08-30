// Данные, на которых строится PDF-отчёт для холодного лида.
// Собираются в ReportService, рендерятся в report.template.ts.

export interface ReportCompetitor {
	position: number // 9 или 10; 0 — если позиция неизвестна (данные из competitors Json)
	domain: string
	url: string
}

export interface ReportKeyword {
	keyword: string
	position: number | null // место сайта лида в выдаче
	competitors: ReportCompetitor[] // все, кто стоит выше лида по этому запросу
	volume: number | null // показов в месяц по Вордстату; null — не удалось получить
}

export interface ReportData {
	domain: string
	companyName: string | null
	addressee: string | null // «Имя Отчество» / «Имя» / null — заполняется руками в админке
	keywords: ReportKeyword[]
	region: string | null // регион, по которому снимались позиции и объёмы
	priceFrom: number // цена «от», рублей в месяц; правится в админке (/holfizz/settings)
	generatedAt: Date
}
