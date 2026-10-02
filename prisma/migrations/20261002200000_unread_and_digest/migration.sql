ALTER TABLE "tg_recipients" ADD COLUMN "unreadIn" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "workspace_settings" ADD COLUMN "tgDigestDay" TEXT;
