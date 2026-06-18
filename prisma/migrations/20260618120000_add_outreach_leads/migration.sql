CREATE TYPE "OutreachStatus" AS ENUM ('NEW', 'CONTACTED', 'REPLIED', 'DEMO', 'INSTALLED', 'PAID', 'DRAFT');

CREATE TABLE "outreach_leads" (
    "id"            TEXT NOT NULL,
    "domain"        TEXT NOT NULL,
    "contact"       TEXT,
    "channel"       TEXT,
    "phone"         TEXT,
    "whatsapp"      TEXT,
    "telegram"      TEXT,
    "email"         TEXT,
    "keywords"      TEXT,
    "message"       TEXT NOT NULL,
    "status"        "OutreachStatus" NOT NULL DEFAULT 'NEW',
    "contactedAt"   TIMESTAMP(3),
    "contactedVia"  TEXT,
    "emailsSent"    INTEGER NOT NULL DEFAULT 0,
    "tgLinkClicked" INTEGER NOT NULL DEFAULT 0,
    "notes"         TEXT,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outreach_leads_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "outreach_leads_status_idx" ON "outreach_leads"("status");
