-- AlterTable
ALTER TABLE "users" ADD COLUMN     "promoCode" TEXT;

-- Index for analytics queries (groupBy promoCode)
CREATE INDEX "users_promoCode_idx" ON "users"("promoCode");
