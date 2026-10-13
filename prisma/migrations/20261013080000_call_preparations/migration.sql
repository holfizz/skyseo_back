CREATE TABLE "crm_call_preparations" (
 "id" TEXT NOT NULL,
 "leadId" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'PENDING',
 "phase" TEXT NOT NULL DEFAULT 'SITE',
 "version" INTEGER NOT NULL DEFAULT 1,
 "research" JSONB NOT NULL,
 "slideOutline" JSONB,
 "clientPdf" BYTEA,
 "scriptPdf" BYTEA,
 "error" TEXT,
 "leaseUntil" TIMESTAMP(3),
 "generatedAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "crm_call_preparations_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "crm_call_preparations_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "crm_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "crm_call_preparations_leadId_key" ON "crm_call_preparations"("leadId");
CREATE INDEX "crm_call_preparations_status_leaseUntil_idx" ON "crm_call_preparations"("status", "leaseUntil");
