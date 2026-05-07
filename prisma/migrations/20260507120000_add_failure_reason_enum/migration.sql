-- CreateEnum FailureReason
CREATE TYPE "FailureReason" AS ENUM ('CAPTCHA', 'SCRIPT_ERROR', 'NOT_IN_SERP', 'LOCK_TIMEOUT');

-- AlterTable executions: change failureReason from TEXT to FailureReason enum
ALTER TABLE "executions" ALTER COLUMN "failureReason" TYPE "FailureReason" USING "failureReason"::"FailureReason";
