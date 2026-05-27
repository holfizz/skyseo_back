-- CreateTable
CREATE TABLE "page_events" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "utmTerm" TEXT,
    "utmContent" TEXT,
    "referrer" TEXT,
    "platform" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "page_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "page_events_type_createdAt_idx" ON "page_events"("type", "createdAt");

-- CreateIndex
CREATE INDEX "page_events_utmSource_createdAt_idx" ON "page_events"("utmSource", "createdAt");
