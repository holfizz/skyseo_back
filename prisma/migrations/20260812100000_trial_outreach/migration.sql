-- Касания по заканчивающимся триалам: карточка менеджеру в CRM-бот + исход.
-- Написана руками (shadow-DB ломает мина 1780430548), как и миграции CRM.
-- Полностью аддитивная: новая таблица и новый enum, существующее не трогаем.

CREATE TYPE "TrialOutreachStatus" AS ENUM ('QUEUED', 'SENT_TO_MANAGER', 'MESSAGE_SENT', 'FAILED');

CREATE TABLE "trial_outreach" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "telegram" TEXT,
    "websiteUrl" TEXT,
    "visits" INTEGER NOT NULL DEFAULT 0,
    "keywords" INTEGER NOT NULL DEFAULT 0,
    "trialEndsAt" TIMESTAMP(3) NOT NULL,
    "status" "TrialOutreachStatus" NOT NULL DEFAULT 'QUEUED',
    "handledBy" TEXT,
    "handledAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trial_outreach_pkey" PRIMARY KEY ("id")
);

-- Одна карточка на пользователя: защищает от повторной отправки, если джоба
-- переживёт рестарт или запустится в двух инстансах одновременно.
CREATE UNIQUE INDEX "trial_outreach_userId_key" ON "trial_outreach"("userId");
CREATE INDEX "trial_outreach_status_createdAt_idx" ON "trial_outreach"("status", "createdAt");

-- Маркер «письмо об окончании триала отправлено». Один раз за всё время,
-- по образцу users.winbackEmailSentAt.
ALTER TABLE "users" ADD COLUMN "trialEndEmailSentAt" TIMESTAMP(3);
