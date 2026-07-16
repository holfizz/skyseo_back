-- SMM: роль SMM + пост-трекинг (регистрации/оплаты по коду поста)

-- Новая роль
ALTER TYPE "Role" ADD VALUE 'SMM';

-- Код SMM-поста, приведшего юзера (== utm_campaign в ссылке)
ALTER TABLE "users" ADD COLUMN "marketingCode" TEXT;
CREATE INDEX "users_marketingCode_idx" ON "users"("marketingCode");

-- Пост в ТГ-канале с трекинг-ссылкой
CREATE TABLE "marketing_posts" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "tgUrl" TEXT,
    "tgText" TEXT,
    "destination" TEXT NOT NULL DEFAULT '/',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketing_posts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "marketing_posts_code_key" ON "marketing_posts"("code");
