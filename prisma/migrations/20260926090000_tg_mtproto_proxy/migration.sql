-- Секрет нужен только для Telegram MTProxy. SOCKS и глобальные прокси его не используют.
ALTER TABLE "tg_proxies" ADD COLUMN IF NOT EXISTS "secret" TEXT;
