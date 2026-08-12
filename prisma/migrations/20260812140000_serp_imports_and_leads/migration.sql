-- Парсинг выдачи Яндекса под холодный аутрич: прогоны, строки выдачи и
-- расширенная карточка лида. Написана руками, как остальные миграции проекта.
--
-- Аддитивная: две новые таблицы + новые колонки у outreach_leads.
-- Откат = DROP двух таблиц иновых колонок.
--
-- Ключевое решение: выдача НЕ дублируется в каждом лиде. Один прогон парсера —
-- одна запись в serp_imports, все строки топ-50 лежат в serp_rows, лид только
-- ссылается на прогон. Иначе у 300 лидов из одного прогона было бы 300 копий
-- одной и той же выдачи.

-- ─── Прогоны парсера ───
CREATE TABLE "serp_imports" (
    "id" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "rowsCount" INTEGER NOT NULL DEFAULT 0,
    "leadsCount" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "serp_imports_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "serp_imports_createdAt_idx" ON "serp_imports"("createdAt");

-- ─── Строки выдачи: ВЕСЬ топ-50, а не только срез 15-50 ───
-- Без верхних позиций нельзя сказать, кто стоит на 9 и 10 месте,
-- а это основа предложения «вас можно поднять на их место».
CREATE TABLE "serp_rows" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "domain" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT,

    CONSTRAINT "serp_rows_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "serp_rows_importId_keyword_position_idx" ON "serp_rows"("importId", "keyword", "position");
CREATE INDEX "serp_rows_domain_idx" ON "serp_rows"("domain");

ALTER TABLE "serp_rows" ADD CONSTRAINT "serp_rows_importId_fkey"
    FOREIGN KEY ("importId") REFERENCES "serp_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Карточка лида ───
ALTER TABLE "outreach_leads" ADD COLUMN "importId" TEXT;
-- Реквизиты с сайта. Контрольные суммы считает yandex-leads/src/contacts.py.
ALTER TABLE "outreach_leads" ADD COLUMN "inn" TEXT;
ALTER TABLE "outreach_leads" ADD COLUMN "ogrn" TEXT;
ALTER TABLE "outreach_leads" ADD COLUMN "ogrnip" TEXT;
ALTER TABLE "outreach_leads" ADD COLUMN "companyName" TEXT;
ALTER TABLE "outreach_leads" ADD COLUMN "city" TEXT;
-- ФИО заполняется руками. Обращение: имя + отчество, если отчество есть, иначе имя.
ALTER TABLE "outreach_leads" ADD COLUMN "firstName" TEXT;
ALTER TABLE "outreach_leads" ADD COLUMN "lastName" TEXT;
ALTER TABLE "outreach_leads" ADD COLUMN "middleName" TEXT;
-- Скоринг: чем по большему числу ключей найден лид и чем выше позиции — тем ценнее.
ALTER TABLE "outreach_leads" ADD COLUMN "keywordsCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "outreach_leads" ADD COLUMN "bestPosition" INTEGER;
ALTER TABLE "outreach_leads" ADD COLUMN "score" INTEGER NOT NULL DEFAULT 0;
-- Конкуренты с 9 и 10 мест по ключам этого лида.
ALTER TABLE "outreach_leads" ADD COLUMN "competitors" JSONB;
-- Трекинг открытий PDF-отчёта: кто прочитал — тот тёплый.
ALTER TABLE "outreach_leads" ADD COLUMN "reportToken" TEXT;
ALTER TABLE "outreach_leads" ADD COLUMN "reportOpenedAt" TIMESTAMP(3);
ALTER TABLE "outreach_leads" ADD COLUMN "reportOpens" INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX "outreach_leads_reportToken_key" ON "outreach_leads"("reportToken");
CREATE INDEX "outreach_leads_score_idx" ON "outreach_leads"("score");
CREATE INDEX "outreach_leads_importId_idx" ON "outreach_leads"("importId");

ALTER TABLE "outreach_leads" ADD CONSTRAINT "outreach_leads_importId_fkey"
    FOREIGN KEY ("importId") REFERENCES "serp_imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;
