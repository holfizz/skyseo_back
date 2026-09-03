-- «Удаление» рассылки без потери переписки: строка остаётся, но прячется.
ALTER TABLE "tg_campaigns" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3);
