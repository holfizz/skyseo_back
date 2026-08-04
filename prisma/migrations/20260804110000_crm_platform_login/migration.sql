-- CRM переходит на общий вход платформы (email + пароль).
-- Telegram остаётся вторым способом входа и каналом уведомлений, но перестаёт быть обязательным.
-- АДДИТИВНО: существующие записи с telegramId продолжают работать как раньше.

-- 1. Связь профиля CRM с аккаунтом платформы. Основной способ входа.
ALTER TABLE "crm_users" ADD COLUMN IF NOT EXISTS "userId" TEXT;
ALTER TABLE "crm_users" ADD COLUMN IF NOT EXISTS "email" TEXT;

-- 2. Telegram больше не обязателен — сотрудник может войти по паролю и привязать TG позже.
ALTER TABLE "crm_users" ALTER COLUMN "telegramId" DROP NOT NULL;

-- 3. Один аккаунт платформы = один профиль CRM.
CREATE UNIQUE INDEX IF NOT EXISTS "crm_users_userId_key" ON "crm_users"("userId");

-- Примечание: FK на users намеренно не ставим — как и у crm_clients."userId".
-- Удаление аккаунта платформы не должно каскадом сносить историю действий в журнале CRM.
