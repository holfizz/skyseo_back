-- Лиды, сделки и тарифы. Полностью аддитивно: новые таблицы и типы,
-- существующие данные не трогаются.

-- ─── Типы ───
DO $$ BEGIN
	CREATE TYPE "CrmLeadStatus" AS ENUM ('NEW', 'IN_WORK', 'QUALIFIED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
	CREATE TYPE "CrmLeadSource" AS ENUM ('SITE_FORM', 'TELEGRAM', 'OUTREACH', 'REFERRAL', 'MANUAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
	CREATE TYPE "CrmDealStatus" AS ENUM ('OPEN', 'WON', 'LOST');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── Лиды: входящие заявки до превращения в клиента ───
CREATE TABLE IF NOT EXISTS "crm_leads" (
	"id" TEXT NOT NULL,
	"title" TEXT NOT NULL,
	"contact" TEXT,
	"source" "CrmLeadSource" NOT NULL DEFAULT 'MANUAL',
	"utm" JSONB,
	"status" "CrmLeadStatus" NOT NULL DEFAULT 'NEW',
	"comment" TEXT,
	"rejectReason" TEXT,
	"assigneeId" TEXT,
	"createdById" TEXT,
	"clientId" TEXT,
	"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
	"updatedAt" TIMESTAMP(3) NOT NULL,
	CONSTRAINT "crm_leads_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "crm_leads_status_createdAt_idx" ON "crm_leads"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "crm_leads_assigneeId_idx" ON "crm_leads"("assigneeId");

-- ─── Тарифы: единый справочник вместо прайса, захардкоженного в трёх местах ───
CREATE TABLE IF NOT EXISTS "tariffs" (
	"id" TEXT NOT NULL,
	"name" TEXT NOT NULL,
	"description" TEXT,
	"points" INTEGER NOT NULL DEFAULT 0,
	"price" INTEGER NOT NULL DEFAULT 0,
	"isActive" BOOLEAN NOT NULL DEFAULT true,
	"position" INTEGER NOT NULL DEFAULT 0,
	"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
	"updatedAt" TIMESTAMP(3) NOT NULL,
	CONSTRAINT "tariffs_pkey" PRIMARY KEY ("id")
);

-- ─── Сделки: деньги в воронке ───
CREATE TABLE IF NOT EXISTS "crm_deals" (
	"id" TEXT NOT NULL,
	"clientId" TEXT NOT NULL,
	"title" TEXT NOT NULL,
	"amount" INTEGER NOT NULL DEFAULT 0,
	"tariffId" TEXT,
	"funnelId" TEXT,
	"stageId" TEXT,
	"probability" INTEGER NOT NULL DEFAULT 50,
	"expectedCloseAt" TIMESTAMP(3),
	"status" "CrmDealStatus" NOT NULL DEFAULT 'OPEN',
	"lostReason" TEXT,
	"assigneeId" TEXT,
	"createdById" TEXT,
	"position" INTEGER NOT NULL DEFAULT 0,
	"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
	"updatedAt" TIMESTAMP(3) NOT NULL,
	CONSTRAINT "crm_deals_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "crm_deals_clientId_idx" ON "crm_deals"("clientId");
CREATE INDEX IF NOT EXISTS "crm_deals_stageId_position_idx" ON "crm_deals"("stageId", "position");
CREATE INDEX IF NOT EXISTS "crm_deals_status_createdAt_idx" ON "crm_deals"("status", "createdAt");

-- ─── Связи ───
-- Удаление клиента уносит его сделки (сделка без клиента бессмысленна).
-- Удаление сотрудника/этапа/тарифа только обнуляет ссылку — история сделок остаётся.
ALTER TABLE "crm_leads"
	ADD CONSTRAINT "crm_leads_assigneeId_fkey" FOREIGN KEY ("assigneeId")
	REFERENCES "crm_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "crm_deals"
	ADD CONSTRAINT "crm_deals_clientId_fkey" FOREIGN KEY ("clientId")
	REFERENCES "crm_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "crm_deals"
	ADD CONSTRAINT "crm_deals_assigneeId_fkey" FOREIGN KEY ("assigneeId")
	REFERENCES "crm_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "crm_deals"
	ADD CONSTRAINT "crm_deals_stageId_fkey" FOREIGN KEY ("stageId")
	REFERENCES "crm_funnel_stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "crm_deals"
	ADD CONSTRAINT "crm_deals_tariffId_fkey" FOREIGN KEY ("tariffId")
	REFERENCES "tariffs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
