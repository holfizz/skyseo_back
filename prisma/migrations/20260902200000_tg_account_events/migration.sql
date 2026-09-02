-- Журнал событий аккаунта: бан, разлогин, спам-блок, обращения в поддержку.
-- Отдельная таблица, а не tg_warmup_actions: те строки считаются активностью
-- прогрева, и переписка со SpamBot портила бы метрику ровности.
CREATE TABLE "tg_account_events" (
    "id"        TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "kind"      TEXT NOT NULL,
    "text"      TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tg_account_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "tg_account_events_accountId_createdAt_idx" ON "tg_account_events"("accountId", "createdAt");
ALTER TABLE "tg_account_events" ADD CONSTRAINT "tg_account_events_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "tg_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
