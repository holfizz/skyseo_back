-- Ручной перенос отправки: такие строки пересборка расписания не трогает.
ALTER TABLE "tg_recipients" ADD COLUMN IF NOT EXISTS "scheduleLocked" BOOLEAN NOT NULL DEFAULT false;
