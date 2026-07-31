-- Ручные проверки позиций через XMLRiver (time-series, накладывается на графики). Аддитивно.
CREATE TABLE "keyword_checks" (
    "id" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "taskId" TEXT,
    "keyword" TEXT NOT NULL,
    "position" INTEGER,
    "url" TEXT,
    "volume" INTEGER,
    "lr" INTEGER NOT NULL,
    "city" TEXT NOT NULL,
    "createdByEmail" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "keyword_checks_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "keyword_checks_websiteId_checkedAt_idx" ON "keyword_checks"("websiteId", "checkedAt");
CREATE INDEX "keyword_checks_taskId_checkedAt_idx" ON "keyword_checks"("taskId", "checkedAt");
