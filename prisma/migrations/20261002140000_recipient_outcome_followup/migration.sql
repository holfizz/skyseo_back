ALTER TABLE "tg_recipients"
  ADD COLUMN "outcome" TEXT,
  ADD COLUMN "outcomeAt" TIMESTAMP(3),
  ADD COLUMN "followUpAt" TIMESTAMP(3),
  ADD COLUMN "followUpNote" TEXT,
  ADD COLUMN "followUpNotifiedAt" TIMESTAMP(3);
CREATE INDEX "tg_recipients_followUpAt_idx" ON "tg_recipients"("followUpAt");
