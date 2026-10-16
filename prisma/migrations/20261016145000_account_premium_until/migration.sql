-- Nullable: do not invent paid subscription dates for existing accounts.
ALTER TABLE "tg_accounts" ADD COLUMN "premiumUntil" TIMESTAMP(3);
