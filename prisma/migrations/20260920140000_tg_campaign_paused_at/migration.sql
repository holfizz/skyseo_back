-- Момент остановки рассылки. У всех существующих строк поле остаётся пустым:
-- прошлые паузы нигде не записывались, и выдумывать им дату нельзя.
ALTER TABLE "tg_campaigns" ADD COLUMN IF NOT EXISTS "pausedAt" TIMESTAMP(3);
