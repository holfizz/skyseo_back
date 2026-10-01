ALTER TABLE "tg_hypotheses" ADD COLUMN "enabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "tg_hypotheses" ALTER COLUMN "campaignId" DROP NOT NULL;
ALTER TABLE "tg_hypotheses" DROP CONSTRAINT "tg_hypotheses_campaignId_fkey";
ALTER TABLE "tg_hypotheses" ADD CONSTRAINT "tg_hypotheses_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "tg_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;
WITH ranked AS (SELECT id, ROW_NUMBER() OVER (ORDER BY "createdAt",position,id)-1 AS n FROM tg_hypotheses) UPDATE tg_hypotheses h SET position=r.n,"campaignId"=NULL FROM ranked r WHERE h.id=r.id;
CREATE TABLE "tg_hypothesis_settings" ("id" TEXT NOT NULL DEFAULT 'main', "enabled" BOOLEAN NOT NULL DEFAULT true, "cursor" INTEGER NOT NULL DEFAULT 0, CONSTRAINT "tg_hypothesis_settings_pkey" PRIMARY KEY ("id"));
INSERT INTO tg_hypothesis_settings (id,cursor) SELECT 'main',COUNT(*)::integer FROM tg_recipients WHERE "hypothesisId" IS NOT NULL;
ALTER TABLE workspace_settings ALTER COLUMN "interestedAfter" SET DEFAULT 3;
UPDATE workspace_settings SET "interestedAfter"=3;
