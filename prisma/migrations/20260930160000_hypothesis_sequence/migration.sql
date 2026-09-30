-- AlterTable
ALTER TABLE "tg_campaigns" ADD COLUMN     "hypothesisCursor" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "tg_hypotheses" ADD COLUMN     "hasSecondMessage" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "position" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "secondMessage" TEXT;


WITH ranked AS (
 SELECT id, row_number() OVER (PARTITION BY "campaignId" ORDER BY "createdAt", id) - 1 AS n
 FROM tg_hypotheses
)
UPDATE tg_hypotheses h SET position = ranked.n FROM ranked WHERE ranked.id = h.id;
UPDATE tg_hypotheses h SET "hasSecondMessage" = c."secondMessage" IS NOT NULL AND length(trim(c."secondMessage")) > 0,
 "secondMessage" = c."secondMessage" FROM tg_campaigns c WHERE c.id = h."campaignId";
UPDATE tg_campaigns c SET "hypothesisCursor" = (
 SELECT count(*)::integer FROM tg_recipients r WHERE r."campaignId" = c.id AND r."hypothesisId" IS NOT NULL
);
