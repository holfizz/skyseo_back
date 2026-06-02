-- Стабильный токен для beacon-пинга от Windows-деинсталлятора (NSIS).
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "uninstallToken" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "users_uninstallToken_key" ON "users"("uninstallToken");
