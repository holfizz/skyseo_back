-- Отчёты по позициям в Яндексе (XMLRiver). Каждый прогон — снапшот позиций всех ключей.
-- Перезапрос = новый прогон; сравнение прогонов даёт историю «было → стало». Аддитивно.
CREATE TABLE "position_reports" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "title" TEXT,
    "city" TEXT NOT NULL DEFAULT 'Москва',
    "keywords" TEXT[],
    "createdByEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "position_reports_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "position_reports_createdAt_idx" ON "position_reports"("createdAt");

CREATE TABLE "position_report_runs" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "results" JSONB NOT NULL,
    "cost" DOUBLE PRECISION,
    "depth" INTEGER,
    "createdByEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "position_report_runs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "position_report_runs_reportId_createdAt_idx" ON "position_report_runs"("reportId", "createdAt");
ALTER TABLE "position_report_runs" ADD CONSTRAINT "position_report_runs_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "position_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
