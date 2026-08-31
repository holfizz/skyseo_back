-- Отметка «контакт найти не удалось» для вкладки поиска в кабинете менеджера.
ALTER TABLE "outreach_leads"
  ADD COLUMN IF NOT EXISTS "contactSearchFailed" BOOLEAN NOT NULL DEFAULT false;
