-- Доработка прогрева: фон после прогрева, ступень роста нормы, стоп-лист.
-- Все значения по умолчанию совпадают с прежним поведением, поэтому идущие
-- прогоны и рассылки ничего не замечают.

-- Утверждённая на сутки норма исходящих: по ней ограничивается рост.
ALTER TABLE "tg_accounts" ADD COLUMN IF NOT EXISTS "dailyCap" INTEGER;
ALTER TABLE "tg_accounts" ADD COLUMN IF NOT EXISTS "dailyCapDate" TEXT;

-- Вид прогона: WARMUP — срочный прогрев, UPKEEP — бессрочный фон.
ALTER TABLE "tg_warmup_runs" ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'WARMUP';

-- Стоп-лист получателей, общий на весь пул.
CREATE TABLE IF NOT EXISTS "tg_stop_list" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "reason" TEXT,
    "label" TEXT,
    "recipientId" TEXT,
    "campaignName" TEXT,
    "accountId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tg_stop_list_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "tg_stop_list_kind_value_key" ON "tg_stop_list"("kind", "value");
CREATE INDEX IF NOT EXISTS "tg_stop_list_createdAt_idx" ON "tg_stop_list"("createdAt");
CREATE INDEX IF NOT EXISTS "tg_stop_list_accountId_createdAt_idx" ON "tg_stop_list"("accountId", "createdAt");
