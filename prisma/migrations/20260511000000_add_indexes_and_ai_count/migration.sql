-- Add aiAnalysesCount field to users
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "aiAnalysesCount" INTEGER NOT NULL DEFAULT 0;

-- Index: users.registrationIp + createdAt (for IP rate-limit check on registration)
CREATE INDEX IF NOT EXISTS "users_registrationIp_createdAt_idx" ON "users"("registrationIp", "createdAt");

-- Index: websites.userId (for getWebsites query)
CREATE INDEX IF NOT EXISTS "websites_userId_idx" ON "websites"("userId");

-- Index: balance_history.userId + createdAt (for getBalanceHistory query)
CREATE INDEX IF NOT EXISTS "balance_history_userId_createdAt_idx" ON "balance_history"("userId", "createdAt");

-- Index: payments.userId (for payment queries)
CREATE INDEX IF NOT EXISTS "payments_userId_idx" ON "payments"("userId");
