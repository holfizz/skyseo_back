-- Прочтение каждого нашего сообщения и «был в сети» собеседника.
-- Опросник и так получает их раз в минуту из списка диалогов, раньше не сохранял.
ALTER TABLE "tg_recipients" ADD COLUMN IF NOT EXISTS "readOutboxMaxId" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "tg_recipients" ADD COLUMN IF NOT EXISTS "peerStatus" TEXT;
ALTER TABLE "tg_recipients" ADD COLUMN IF NOT EXISTS "peerSeenAt" TIMESTAMP(3);
ALTER TABLE "tg_recipients" ADD COLUMN IF NOT EXISTS "peerCheckedAt" TIMESTAMP(3);
