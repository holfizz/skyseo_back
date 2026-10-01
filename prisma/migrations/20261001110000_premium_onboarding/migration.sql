ALTER TABLE tg_accounts ADD COLUMN "purchasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, ADD COLUMN "outreachStartedAt" TIMESTAMP(3);
UPDATE tg_accounts SET "purchasedAt"="createdAt";
UPDATE tg_accounts a SET "outreachStartedAt"=r.first_sent FROM (SELECT "accountId",MIN("sentAt") AS first_sent FROM tg_recipients WHERE "sentAt" IS NOT NULL GROUP BY "accountId") r WHERE a.id=r."accountId";
UPDATE tg_warmup_runs SET status='STOPPED',"finishedAt"=CURRENT_TIMESTAMP,"nextRunAt"=NULL,"lockedAt"=NULL WHERE status IN ('SCHEDULED','RUNNING');
UPDATE tg_accounts SET status='READY' WHERE status='WARMING';
UPDATE tg_accounts SET "busyUntil"=NULL,"busyBy"=NULL WHERE "busyBy"='warmup';
UPDATE tg_accounts SET "forceSend"=false;
ALTER TABLE tg_accounts ADD COLUMN "premiumCheckedAt" TIMESTAMP(3);
ALTER TABLE tg_accounts ADD COLUMN "restrictedUntil" TIMESTAMP(3);
