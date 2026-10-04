-- Nullable, idempotent addition: preserves existing contacts and avoids rewriting rows.
ALTER TABLE "outreach_leads" ADD COLUMN IF NOT EXISTS "telegramId" TEXT;
