-- Яндекс РСЯ / Direct кампании
CREATE TABLE "yandex_ad_campaigns" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "geo" TEXT,
    "landingUrl" TEXT,
    "dailyBudget" INTEGER NOT NULL DEFAULT 0,
    "adsHeadlines" TEXT,
    "adsDescriptions" TEXT,
    "avatarOk" BOOLEAN NOT NULL DEFAULT false,
    "keywordsResearchOk" BOOLEAN NOT NULL DEFAULT false,
    "analyticsOk" BOOLEAN NOT NULL DEFAULT false,
    "triadLinkOk" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "yandex_ad_campaigns_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "yandex_ad_keywords" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "frequency" INTEGER NOT NULL DEFAULT 0,
    "estimatedCpc" INTEGER NOT NULL DEFAULT 0,
    "competition" TEXT,
    "shouldLaunch" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "yandex_ad_keywords_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "yandex_ad_keywords_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "yandex_ad_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "yandex_ad_keywords_campaignId_idx" ON "yandex_ad_keywords"("campaignId");

-- Telegram посевы
CREATE TABLE "telegram_ad_campaigns" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "postText" TEXT,
    "landingUrl" TEXT,
    "budget" INTEGER NOT NULL DEFAULT 0,
    "expectedViews" INTEGER NOT NULL DEFAULT 0,
    "expectedClicks" INTEGER NOT NULL DEFAULT 0,
    "expectedLeads" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "telegram_ad_campaigns_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "telegram_ad_channels" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "link" TEXT NOT NULL,
    "name" TEXT,
    "adReturn" INTEGER,
    "subscribers" INTEGER,
    "reach24" INTEGER,
    "err24" INTEGER,
    "postCost" INTEGER,
    "isAuthor" BOOLEAN NOT NULL DEFAULT false,
    "shouldBuy" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "telegram_ad_channels_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "telegram_ad_channels_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "telegram_ad_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "telegram_ad_channels_campaignId_idx" ON "telegram_ad_channels"("campaignId");
