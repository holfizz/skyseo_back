ALTER TABLE "crm_users" ADD COLUMN "calendarFeedTokenHash" TEXT;
CREATE UNIQUE INDEX "crm_users_calendarFeedTokenHash_key" ON "crm_users"("calendarFeedTokenHash");
