-- День, на который запланирована рассылка. NULL — прежнее поведение:
-- очередь растекается по дням, пока не кончится.
ALTER TABLE "tg_campaigns" ADD COLUMN IF NOT EXISTS "sendDate" TIMESTAMP(3);
