-- Рассылка в Telegram с прогретых аккаунтов: кампании, адресаты, переписка.

CREATE TYPE "TgCampaignStatus"  AS ENUM ('DRAFT', 'RUNNING', 'PAUSED', 'DONE');
CREATE TYPE "TgRecipientStatus" AS ENUM ('QUEUED', 'SENT', 'READ', 'REPLIED', 'SECOND_SENT', 'BLOCKED', 'FAILED', 'STOPPED');

CREATE TABLE "tg_campaigns" (
    "id"               TEXT NOT NULL,
    "name"             TEXT NOT NULL,
    "status"           "TgCampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "firstMessage"     TEXT NOT NULL,
    "secondMessage"    TEXT,
    -- Лимиты на КАЖДЫЙ аккаунт, а не на кампанию: предел есть у аккаунта.
    "perAccountPerDay" INTEGER NOT NULL DEFAULT 20,
    "minIntervalSec"   INTEGER NOT NULL DEFAULT 240,
    "maxIntervalSec"   INTEGER NOT NULL DEFAULT 1200,
    "windowFrom"       INTEGER NOT NULL DEFAULT 10,
    "windowTo"         INTEGER NOT NULL DEFAULT 20,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt"        TIMESTAMP(3),
    "finishedAt"       TIMESTAMP(3),
    CONSTRAINT "tg_campaigns_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "tg_campaigns_status_idx" ON "tg_campaigns"("status");

CREATE TABLE "tg_campaign_accounts" (
    "id"          TEXT NOT NULL,
    "campaignId"  TEXT NOT NULL,
    "accountId"   TEXT NOT NULL,
    "sentToday"   INTEGER NOT NULL DEFAULT 0,
    "dayKey"      TEXT,
    "nextSendAt"  TIMESTAMP(3),
    "pausedUntil" TIMESTAMP(3),
    "lastError"   TEXT,
    CONSTRAINT "tg_campaign_accounts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "tg_campaign_accounts_campaignId_accountId_key" ON "tg_campaign_accounts"("campaignId", "accountId");
ALTER TABLE "tg_campaign_accounts" ADD CONSTRAINT "tg_campaign_accounts_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "tg_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tg_campaign_accounts" ADD CONSTRAINT "tg_campaign_accounts_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "tg_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "tg_recipients" (
    "id"            TEXT NOT NULL,
    "campaignId"    TEXT NOT NULL,
    "username"      TEXT,
    "phone"         TEXT,
    "tgUserId"      TEXT,
    "leadId"        TEXT,
    "firstName"     TEXT,
    "middleName"    TEXT,
    "lastName"      TEXT,
    "company"       TEXT,
    "domain"        TEXT,
    "status"        "TgRecipientStatus" NOT NULL DEFAULT 'QUEUED',
    -- Аккаунт закрепляется при первой отправке: переписку нельзя продолжать
    -- с другого аккаунта.
    "accountId"     TEXT,
    "sentAt"        TIMESTAMP(3),
    "sentMsgId"     INTEGER,
    "readAt"        TIMESTAMP(3),
    "repliedAt"     TIMESTAMP(3),
    "secondSentAt"  TIMESTAMP(3),
    "blockedAt"     TIMESTAMP(3),
    "error"         TEXT,
    "attempts"      INTEGER NOT NULL DEFAULT 0,
    "lastSeenMsgId" INTEGER NOT NULL DEFAULT 0,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tg_recipients_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "tg_recipients_campaignId_status_idx" ON "tg_recipients"("campaignId", "status");
CREATE INDEX "tg_recipients_status_idx" ON "tg_recipients"("status");
ALTER TABLE "tg_recipients" ADD CONSTRAINT "tg_recipients_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "tg_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tg_recipients" ADD CONSTRAINT "tg_recipients_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "tg_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Переписка хранится у нас: аккаунт может умереть, а разговор нужен и после.
CREATE TABLE "tg_dialog_messages" (
    "id"          TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "tgId"        INTEGER NOT NULL,
    "out"         BOOLEAN NOT NULL,
    "text"        TEXT NOT NULL,
    "date"        TIMESTAMP(3) NOT NULL,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tg_dialog_messages_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "tg_dialog_messages_recipientId_tgId_key" ON "tg_dialog_messages"("recipientId", "tgId");
CREATE INDEX "tg_dialog_messages_recipientId_date_idx" ON "tg_dialog_messages"("recipientId", "date");
ALTER TABLE "tg_dialog_messages" ADD CONSTRAINT "tg_dialog_messages_recipientId_fkey"
    FOREIGN KEY ("recipientId") REFERENCES "tg_recipients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
