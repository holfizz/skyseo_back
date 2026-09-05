-- Вложения в переписке: фото, стикеры, гифки от собеседника.
-- Только добавление колонок, существующие сообщения не трогаются.
ALTER TABLE "tg_dialog_messages" ADD COLUMN IF NOT EXISTS "mediaKind" TEXT;
ALTER TABLE "tg_dialog_messages" ADD COLUMN IF NOT EXISTS "mediaData" TEXT;
ALTER TABLE "tg_dialog_messages" ADD COLUMN IF NOT EXISTS "mediaName" TEXT;
ALTER TABLE "tg_dialog_messages" ADD COLUMN IF NOT EXISTS "mediaSize" INTEGER;
