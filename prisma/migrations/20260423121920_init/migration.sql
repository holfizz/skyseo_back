-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "TaskType" AS ENUM ('SEARCH_KEYWORD', 'EXTERNAL_LINK', 'SEARCH_AND_VISIT');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('PENDING', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ExecutionStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "BalanceHistoryType" AS ENUM ('WELCOME_BONUS', 'TASK_EARNED', 'TASK_SPENT', 'PAYMENT', 'REFUND', 'ADMIN_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'CANCELED', 'FAILED');

-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('DARWIN_ARM64', 'DARWIN_X64', 'WIN32_X64', 'WIN32_IA32');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 1000,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "referralSource" TEXT,
    "city" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isSuspicious" BOOLEAN NOT NULL DEFAULT false,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "emailVerificationToken" TEXT,
    "lastLoginIp" TEXT,
    "registrationIp" TEXT,
    "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastFailedLogin" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "websites" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "city" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "websites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "type" "TaskType" NOT NULL,
    "keyword" TEXT,
    "externalUrl" TEXT,
    "geo" TEXT NOT NULL DEFAULT 'Москва',
    "status" "TaskStatus" NOT NULL DEFAULT 'PENDING',
    "pointsCost" INTEGER NOT NULL DEFAULT 10,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "maxYandexVisits" INTEGER NOT NULL DEFAULT 3,
    "maxGoogleVisits" INTEGER NOT NULL DEFAULT 3,
    "useYandex" BOOLEAN NOT NULL DEFAULT true,
    "useGoogle" BOOLEAN NOT NULL DEFAULT true,
    "pagesDepthFrom" INTEGER NOT NULL DEFAULT 3,
    "pagesDepthTo" INTEGER NOT NULL DEFAULT 5,
    "pageDurationFrom" INTEGER NOT NULL DEFAULT 60,
    "pageDurationTo" INTEGER NOT NULL DEFAULT 180,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "assignedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "executions" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "executorId" TEXT NOT NULL,
    "websiteId" TEXT,
    "status" "ExecutionStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "pointsEarned" INTEGER NOT NULL DEFAULT 0,
    "pointsSpent" INTEGER NOT NULL DEFAULT 0,
    "foundInTop" BOOLEAN,
    "position" INTEGER,
    "pagesVisited" INTEGER NOT NULL DEFAULT 0,
    "duration" INTEGER NOT NULL DEFAULT 0,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "weekStart" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "statistics" (
    "id" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "position" INTEGER,
    "inTop1" INTEGER NOT NULL DEFAULT 0,
    "inTop2_3" INTEGER NOT NULL DEFAULT 0,
    "inTop5" INTEGER NOT NULL DEFAULT 0,
    "inTop10" INTEGER NOT NULL DEFAULT 0,
    "inTop50" INTEGER NOT NULL DEFAULT 0,
    "belowTop50" INTEGER NOT NULL DEFAULT 0,
    "totalVisits" INTEGER NOT NULL DEFAULT 0,
    "yandexSearches" INTEGER NOT NULL DEFAULT 0,
    "googleSearches" INTEGER NOT NULL DEFAULT 0,
    "yandexVisits" INTEGER NOT NULL DEFAULT 0,
    "googleVisits" INTEGER NOT NULL DEFAULT 0,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "statistics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "position_history" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "yandexPosition" INTEGER,
    "googlePosition" INTEGER,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "position_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "balance_history" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "type" "BalanceHistoryType" NOT NULL,
    "description" TEXT NOT NULL,
    "taskId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "balance_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "points" INTEGER NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "provider" TEXT NOT NULL DEFAULT 'yookassa',
    "externalId" TEXT,
    "confirmationUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_versions" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "downloadUrl" TEXT NOT NULL,
    "sha512" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "releaseNotes" TEXT[],
    "mandatory" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_emailVerificationToken_key" ON "users"("emailVerificationToken");

-- CreateIndex
CREATE INDEX "tasks_status_priority_idx" ON "tasks"("status", "priority");

-- CreateIndex
CREATE INDEX "executions_executorId_websiteId_weekStart_idx" ON "executions"("executorId", "websiteId", "weekStart");

-- CreateIndex
CREATE UNIQUE INDEX "statistics_websiteId_keyword_date_key" ON "statistics"("websiteId", "keyword", "date");

-- CreateIndex
CREATE INDEX "position_history_taskId_date_idx" ON "position_history"("taskId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "payments_externalId_key" ON "payments"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "app_versions_version_platform_key" ON "app_versions"("version", "platform");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_key" ON "password_reset_tokens"("token");

-- AddForeignKey
ALTER TABLE "websites" ADD CONSTRAINT "websites_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "websites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "executions" ADD CONSTRAINT "executions_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "executions" ADD CONSTRAINT "executions_executorId_fkey" FOREIGN KEY ("executorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "statistics" ADD CONSTRAINT "statistics_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "websites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "position_history" ADD CONSTRAINT "position_history_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "balance_history" ADD CONSTRAINT "balance_history_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
