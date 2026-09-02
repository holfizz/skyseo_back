-- Режим аккаунта и захват воркером.

-- Чем аккаунту заниматься: только греться, только рассылать или и то и другое.
ALTER TABLE "tg_accounts" ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'BOTH';

-- Захват: два одновременных подключения с одной сессии Telegram видит, поэтому
-- прогрев и рассылка ходят к аккаунту по очереди. busyUntil страхует от того,
-- что воркер упал и не снял захват.
ALTER TABLE "tg_accounts" ADD COLUMN "busyUntil" TIMESTAMP(3);
ALTER TABLE "tg_accounts" ADD COLUMN "busyBy" TEXT;

-- Индекс под выборку свободных аккаунтов.
CREATE INDEX "tg_accounts_busyUntil_idx" ON "tg_accounts"("busyUntil");
