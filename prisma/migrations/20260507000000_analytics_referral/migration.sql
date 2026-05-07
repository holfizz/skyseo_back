-- AlterTable users: add referral fields and weeklyReportEnabled
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "referralCode" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "referredBy" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "weeklyReportEnabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex for unique referralCode
CREATE UNIQUE INDEX IF NOT EXISTS "users_referralCode_key" ON "users"("referralCode");

-- AlterTable executions: add per-engine fields and failureReason
ALTER TABLE "executions" ADD COLUMN IF NOT EXISTS "yandexFoundInTop" BOOLEAN;
ALTER TABLE "executions" ADD COLUMN IF NOT EXISTS "googleFoundInTop" BOOLEAN;
ALTER TABLE "executions" ADD COLUMN IF NOT EXISTS "yandexPosition" INTEGER;
ALTER TABLE "executions" ADD COLUMN IF NOT EXISTS "googlePosition" INTEGER;
ALTER TABLE "executions" ADD COLUMN IF NOT EXISTS "failureReason" TEXT;

-- CreateEnum FailureReason (stored as TEXT, validated in app layer)

-- CreateEnum BalanceHistoryType value REFERRAL_BONUS
ALTER TYPE "BalanceHistoryType" ADD VALUE IF NOT EXISTS 'REFERRAL_BONUS';

-- CreateTable captcha_events
CREATE TABLE IF NOT EXISTS "captcha_events" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "engine" TEXT NOT NULL,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "captcha_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "captcha_events_createdAt_idx" ON "captcha_events"("createdAt");

-- AddForeignKey
ALTER TABLE "captcha_events" ADD CONSTRAINT "captcha_events_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
