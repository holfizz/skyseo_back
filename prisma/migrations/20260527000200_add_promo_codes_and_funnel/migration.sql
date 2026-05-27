-- PromoCode table — управление промокодами через админку (заменяет hardcode)
CREATE TABLE "promo_codes" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "bonusPoints" INTEGER NOT NULL DEFAULT 500,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "promo_codes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "promo_codes_code_key" ON "promo_codes"("code");

-- Seed существующих хардкод-кодов чтобы они продолжили работать
INSERT INTO "promo_codes" ("id", "code", "bonusPoints", "description", "isActive", "createdAt", "updatedAt") VALUES
    (gen_random_uuid()::text, 'INSTAGRAM', 500, 'Instagram реклама', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'TG', 500, 'Telegram канал SkySEO', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'YOUTUBE', 1000, 'YouTube блогеры', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'VC', 500, 'vc.ru статья', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'HABR', 500, 'Habr статья', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'FRIEND', 300, 'От друга', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- FunnelEntry table — учёт воронки по каналам
CREATE TABLE "funnel_entries" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "channel" TEXT NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "cost" INTEGER NOT NULL DEFAULT 0,
    "registrations" INTEGER NOT NULL DEFAULT 0,
    "purchases" INTEGER NOT NULL DEFAULT 0,
    "revenue" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "funnel_entries_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "funnel_entries_channel_idx" ON "funnel_entries"("channel");
CREATE INDEX "funnel_entries_date_idx" ON "funnel_entries"("date");
