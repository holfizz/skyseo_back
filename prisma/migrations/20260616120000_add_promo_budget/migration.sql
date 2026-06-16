ALTER TABLE "promo_codes" ADD COLUMN "budgetAmount" DECIMAL(10,2);
ALTER TABLE "promo_codes" ADD COLUMN "budgetMode" TEXT NOT NULL DEFAULT 'total';
