-- Ежедневная награда за онлайн-активность приложения (50 баллов/день за heartbeat)

-- Новый тип операции в истории баланса
ALTER TYPE "BalanceHistoryType" ADD VALUE 'DAILY_REWARD';

-- Таблица ежедневных начислений (идемпотентность и календарь — по (userId, date))
CREATE TABLE "daily_rewards" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 50,
    "streak" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_rewards_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "daily_rewards_userId_date_key" ON "daily_rewards"("userId", "date");

CREATE INDEX "daily_rewards_userId_date_idx" ON "daily_rewards"("userId", "date");

ALTER TABLE "daily_rewards" ADD CONSTRAINT "daily_rewards_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
