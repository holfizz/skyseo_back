-- Кабинет менеджера: недельные спринты, факт отправок, разбор недели.

CREATE TABLE "sprints" (
    "id"            TEXT NOT NULL,
    "number"        INTEGER NOT NULL,
    "startsOn"      DATE NOT NULL,
    "endsOn"        DATE NOT NULL,
    "focus"         TEXT NOT NULL,
    "messagesWeek"  INTEGER NOT NULL,
    "messagesDay"   INTEGER NOT NULL,
    "networkTarget" INTEGER NOT NULL,
    "updatedAt"     TIMESTAMP(3) NOT NULL,
    CONSTRAINT "sprints_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "sprints_number_key" ON "sprints"("number");
CREATE INDEX "sprints_startsOn_idx" ON "sprints"("startsOn");

-- Факт отправки. UNIQUE(leadId, step) — одно и то же сообщение одному лиду
-- нельзя засчитать дважды.
CREATE TABLE "outreach_touches" (
    "id"        TEXT NOT NULL,
    "leadId"    TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "step"      INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "outreach_touches_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "outreach_touches_leadId_step_key" ON "outreach_touches"("leadId", "step");
CREATE INDEX "outreach_touches_createdAt_idx" ON "outreach_touches"("createdAt");
CREATE INDEX "outreach_touches_userId_createdAt_idx" ON "outreach_touches"("userId", "createdAt");
ALTER TABLE "outreach_touches" ADD CONSTRAINT "outreach_touches_leadId_fkey"
    FOREIGN KEY ("leadId") REFERENCES "outreach_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "outreach_touches" ADD CONSTRAINT "outreach_touches_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "sprint_reviews" (
    "id"        TEXT NOT NULL,
    "sprintId"  TEXT NOT NULL,
    "comment"   TEXT NOT NULL,
    "authorId"  TEXT NOT NULL,
    "sentAt"    TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sprint_reviews_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "sprint_reviews_sprintId_key" ON "sprint_reviews"("sprintId");
ALTER TABLE "sprint_reviews" ADD CONSTRAINT "sprint_reviews_sprintId_fkey"
    FOREIGN KEY ("sprintId") REFERENCES "sprints"("id") ON DELETE CASCADE ON UPDATE CASCADE;
