-- AlterTable
ALTER TABLE "tg_recipients" ADD COLUMN     "hypothesisId" TEXT;

-- CreateTable
CREATE TABLE "workspace_clients" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "telegram" TEXT,
    "website" TEXT,
    "monthlyFee" DECIMAL(14,2) NOT NULL,
    "startsOn" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "cancelledOn" DATE,
    "cancellationReason" TEXT,
    "notes" TEXT NOT NULL DEFAULT '',
    "topvisorLinks" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_months" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "received" DECIMAL(14,2) NOT NULL,
    "expenses" DECIMAL(14,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PAID',
    "note" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_months_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_contracts" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_settings" (
    "id" TEXT NOT NULL DEFAULT 'main',
    "dailyGoal" INTEGER NOT NULL DEFAULT 200,
    "interestedAfter" INTEGER NOT NULL DEFAULT 5,
    "planningPerAccount" INTEGER NOT NULL DEFAULT 20,

    CONSTRAINT "workspace_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tg_hypotheses" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tg_hypotheses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workspace_months_clientId_month_key" ON "workspace_months"("clientId", "month");

-- CreateIndex
CREATE INDEX "tg_hypotheses_campaignId_idx" ON "tg_hypotheses"("campaignId");

-- AddForeignKey
ALTER TABLE "tg_recipients" ADD CONSTRAINT "tg_recipients_hypothesisId_fkey" FOREIGN KEY ("hypothesisId") REFERENCES "tg_hypotheses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_months" ADD CONSTRAINT "workspace_months_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "workspace_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_contracts" ADD CONSTRAINT "workspace_contracts_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "workspace_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tg_hypotheses" ADD CONSTRAINT "tg_hypotheses_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "tg_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

