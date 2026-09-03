-- Расписание рассылки: когда и с какого аккаунта уйдёт сообщение.
-- Только добавление колонок и индекса, существующие данные не трогаются:
-- у всех текущих адресатов поля останутся NULL, и отправщик обработает их
-- по-старому — первым в очереди, любым свободным аккаунтом.
ALTER TABLE "tg_recipients" ADD COLUMN IF NOT EXISTS "scheduledAt" TIMESTAMP(3);
ALTER TABLE "tg_recipients" ADD COLUMN IF NOT EXISTS "plannedAccountId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tg_recipients_plannedAccountId_fkey'
  ) THEN
    ALTER TABLE "tg_recipients"
      ADD CONSTRAINT "tg_recipients_plannedAccountId_fkey"
      FOREIGN KEY ("plannedAccountId") REFERENCES "tg_accounts"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "tg_recipients_campaignId_plannedAccountId_status_scheduledAt_idx"
  ON "tg_recipients" ("campaignId", "plannedAccountId", "status", "scheduledAt");
