-- Привязка Telegram-бота уведомлений к пользователю
ALTER TABLE "users" ADD COLUMN "telegramChatId" TEXT;
ALTER TABLE "users" ADD COLUMN "telegramUsername" TEXT;
ALTER TABLE "users" ADD COLUMN "telegramLinkCode" TEXT;
ALTER TABLE "users" ADD COLUMN "telegramLinkCodeExpiresAt" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "telegramLinkedAt" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "telegramContact" TEXT;

CREATE UNIQUE INDEX "users_telegramChatId_key" ON "users"("telegramChatId");
CREATE UNIQUE INDEX "users_telegramLinkCode_key" ON "users"("telegramLinkCode");

-- Позиция, о росте до которой уже уведомляли (письма о росте только на новый рекорд)
ALTER TABLE "tasks" ADD COLUMN "notifiedBestPosition" INTEGER;

-- Скидочная ссылка на брошенный (PENDING) платёж
ALTER TABLE "payments" ADD COLUMN "offerSentAt" TIMESTAMP(3);
ALTER TABLE "payments" ADD COLUMN "discountToken" TEXT;

CREATE UNIQUE INDEX "payments_discountToken_key" ON "payments"("discountToken");
