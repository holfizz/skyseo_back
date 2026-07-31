-- CRM воронки (пайплайны) с произвольными этапами. Аддитивно.

-- CreateTable crm_funnels
CREATE TABLE "crm_funnels" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_funnels_pkey" PRIMARY KEY ("id")
);

-- CreateTable crm_funnel_stages
CREATE TABLE "crm_funnel_stages" (
    "id" TEXT NOT NULL,
    "funnelId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#a0b5ff',
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_funnel_stages_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "crm_funnel_stages_funnelId_position_idx" ON "crm_funnel_stages"("funnelId", "position");

-- AlterTable crm_clients: привязка к воронке/этапу
ALTER TABLE "crm_clients" ADD COLUMN "funnelId" TEXT;
ALTER TABLE "crm_clients" ADD COLUMN "stageId" TEXT;
CREATE INDEX "crm_clients_stageId_idx" ON "crm_clients"("stageId");

-- AddForeignKey
ALTER TABLE "crm_funnel_stages" ADD CONSTRAINT "crm_funnel_stages_funnelId_fkey" FOREIGN KEY ("funnelId") REFERENCES "crm_funnels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_clients" ADD CONSTRAINT "crm_clients_funnelId_fkey" FOREIGN KEY ("funnelId") REFERENCES "crm_funnels"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_clients" ADD CONSTRAINT "crm_clients_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "crm_funnel_stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
