-- Набор статусов аутрича сокращён до рабочей воронки:
--   NEW → импортирован, ещё не писали (стартовое состояние, руками не ставится)
--   CONTACTED → отправил, INTERESTED → заинтересовался,
--   REJECTED → отказался, PAID → оплатил
--
-- Postgres не умеет удалять значения из enum, поэтому создаём новый тип и
-- переносим колонку с перекладкой старых значений:
--   REPLIED / DEMO / INSTALLED → INTERESTED (все три означали «ответил и общается»)
--   DRAFT → NEW (статус «нет ответа 7 дней» уходит вместе с джобой moveStaleToDraft)

CREATE TYPE "OutreachStatus_new" AS ENUM ('NEW', 'CONTACTED', 'INTERESTED', 'REJECTED', 'PAID');

ALTER TABLE "outreach_leads" ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "outreach_leads"
  ALTER COLUMN "status" TYPE "OutreachStatus_new"
  USING (
    CASE "status"::text
      WHEN 'REPLIED'   THEN 'INTERESTED'
      WHEN 'DEMO'      THEN 'INTERESTED'
      WHEN 'INSTALLED' THEN 'INTERESTED'
      WHEN 'DRAFT'     THEN 'NEW'
      ELSE "status"::text
    END
  )::"OutreachStatus_new";

ALTER TABLE "outreach_leads" ALTER COLUMN "status" SET DEFAULT 'NEW';

DROP TYPE "OutreachStatus";
ALTER TYPE "OutreachStatus_new" RENAME TO "OutreachStatus";
