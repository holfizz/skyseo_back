-- AddColumn appInstalled, appDeleted, appLastLoginAt к User
ALTER TABLE "users" ADD COLUMN "appInstalled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "appDeleted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "appLastLoginAt" TIMESTAMP(3);
