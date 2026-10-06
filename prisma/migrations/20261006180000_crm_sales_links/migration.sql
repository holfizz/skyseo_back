-- CreateEnum
CREATE TYPE "CrmTaskKind" AS ENUM ('GENERAL', 'CALL', 'FOLLOW_UP', 'SEO_EVALUATION', 'PROPOSAL');

-- AlterTable
ALTER TABLE "crm_tasks" ADD COLUMN     "followUpRecipientId" TEXT,
ADD COLUMN     "kind" "CrmTaskKind" NOT NULL DEFAULT 'GENERAL',
ADD COLUMN     "leadId" TEXT;

-- AlterTable
ALTER TABLE "crm_leads" ADD COLUMN     "budgetComment" TEXT,
ADD COLUMN     "budgetMax" INTEGER,
ADD COLUMN     "budgetMin" INTEGER,
ADD COLUMN     "decisionMaker" TEXT,
ADD COLUMN     "funnelId" TEXT,
ADD COLUMN     "outreachLeadId" TEXT,
ADD COLUMN     "qualification" JSONB,
ADD COLUMN     "sourceRecipientId" TEXT,
ADD COLUMN     "stageId" TEXT;

-- AlterTable
ALTER TABLE "crm_deals" ADD COLUMN     "leadId" TEXT,
ADD COLUMN     "lostComment" TEXT;

-- AlterTable
ALTER TABLE "tg_recipients" ADD COLUMN     "crmLeadId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "crm_tasks_followUpRecipientId_key" ON "crm_tasks"("followUpRecipientId");

-- CreateIndex
CREATE INDEX "crm_tasks_leadId_dueAt_idx" ON "crm_tasks"("leadId", "dueAt");

-- CreateIndex
CREATE INDEX "crm_tasks_kind_status_dueAt_idx" ON "crm_tasks"("kind", "status", "dueAt");

-- CreateIndex
CREATE INDEX "crm_activity_entityType_entityId_createdAt_idx" ON "crm_activity"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "crm_leads_outreachLeadId_key" ON "crm_leads"("outreachLeadId");

-- CreateIndex
CREATE UNIQUE INDEX "crm_leads_sourceRecipientId_key" ON "crm_leads"("sourceRecipientId");

-- CreateIndex
CREATE INDEX "crm_leads_funnelId_stageId_idx" ON "crm_leads"("funnelId", "stageId");

-- CreateIndex
CREATE INDEX "crm_deals_leadId_idx" ON "crm_deals"("leadId");

-- CreateIndex
CREATE INDEX "tg_recipients_leadId_idx" ON "tg_recipients"("leadId");

-- CreateIndex
CREATE INDEX "tg_recipients_crmLeadId_idx" ON "tg_recipients"("crmLeadId");

-- AddForeignKey
ALTER TABLE "crm_tasks" ADD CONSTRAINT "crm_tasks_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "crm_leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_tasks" ADD CONSTRAINT "crm_tasks_followUpRecipientId_fkey" FOREIGN KEY ("followUpRecipientId") REFERENCES "tg_recipients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_outreachLeadId_fkey" FOREIGN KEY ("outreachLeadId") REFERENCES "outreach_leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_sourceRecipientId_fkey" FOREIGN KEY ("sourceRecipientId") REFERENCES "tg_recipients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "crm_clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_funnelId_fkey" FOREIGN KEY ("funnelId") REFERENCES "crm_funnels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "crm_funnel_stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "crm_leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tg_recipients" ADD CONSTRAINT "tg_recipients_crmLeadId_fkey" FOREIGN KEY ("crmLeadId") REFERENCES "crm_leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Existing Telegram follow-ups become CRM tasks before CRM screens use them.
-- Keep legacy columns intact for the current Telegram reminder sender.
INSERT INTO "crm_tasks" (
  "id", "kind", "title", "description", "status", "dueAt",
  "followUpRecipientId", "createdAt", "updatedAt"
)
SELECT gen_random_uuid()::text, 'FOLLOW_UP',
  left('Написать ' || COALESCE(NULLIF(trim(concat_ws(' ', r."firstName", r."middleName")), ''),
    NULLIF(r."username", ''), NULLIF(r."phone", ''), NULLIF(r."domain", ''), 'контакту'), 200),
  r."followUpNote", 'TODO', r."followUpAt", r."id", now(), now()
FROM "tg_recipients" r
WHERE r."followUpAt" IS NOT NULL;

INSERT INTO "crm_reminders" (
  "id", "taskId", "remindAt", "offsetLabel", "sent", "sentAt", "createdAt"
)
SELECT gen_random_uuid()::text, t."id", t."dueAt", 'follow-up',
  r."followUpNotifiedAt" IS NOT NULL, r."followUpNotifiedAt", now()
FROM "crm_tasks" t
JOIN "tg_recipients" r ON r."id" = t."followUpRecipientId"
WHERE t."kind" = 'FOLLOW_UP' AND t."dueAt" IS NOT NULL;

-- Editable default sales funnel. Fixed IDs make this seed idempotent.
INSERT INTO "crm_funnels" ("id", "name", "position", "createdAt", "updatedAt")
VALUES ('skyseo-sales', 'Продажи SEO', 0, now(), now())
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "crm_funnel_stages" ("id", "funnelId", "title", "position", "createdAt")
VALUES
  ('skyseo-sales-new', 'skyseo-sales', 'Новый', 0, now()),
  ('skyseo-sales-contacted', 'skyseo-sales', 'Написали', 1, now()),
  ('skyseo-sales-replied', 'skyseo-sales', 'Ответил', 2, now()),
  ('skyseo-sales-interested', 'skyseo-sales', 'Заинтересован', 3, now()),
  ('skyseo-sales-call-booked', 'skyseo-sales', 'Созвон назначен', 4, now()),
  ('skyseo-sales-call-done', 'skyseo-sales', 'Созвон проведён', 5, now()),
  ('skyseo-sales-qualified', 'skyseo-sales', 'Квалифицирован', 6, now()),
  ('skyseo-sales-seo-review', 'skyseo-sales', 'Оценка SEO-специалиста', 7, now()),
  ('skyseo-sales-proposal', 'skyseo-sales', 'Предложение отправлено', 8, now()),
  ('skyseo-sales-test', 'skyseo-sales', 'Тест / диагностика', 9, now()),
  ('skyseo-sales-decision', 'skyseo-sales', 'Решение', 10, now()),
  ('skyseo-sales-client', 'skyseo-sales', 'Клиент', 11, now())
ON CONFLICT ("id") DO NOTHING;
