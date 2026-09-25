-- Ответ на конкретное сообщение: id того сообщения в Telegram.
-- Только добавление колонки, существующие сообщения не трогаются.
ALTER TABLE "tg_dialog_messages" ADD COLUMN IF NOT EXISTS "replyToTgId" INTEGER;
