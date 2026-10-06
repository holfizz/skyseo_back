-- CreateEnum
CREATE TYPE "CrmCustomFieldType" AS ENUM ('BOOLEAN', 'TEXT', 'TEXTAREA', 'NUMBER', 'SELECT', 'MULTI_SELECT', 'DATE');

-- CreateTable
CREATE TABLE "crm_custom_field_definitions" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "entityType" TEXT NOT NULL DEFAULT 'LEAD',
    "type" "CrmCustomFieldType" NOT NULL,
    "options" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "position" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_custom_field_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_custom_field_values" (
    "id" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "valueBoolean" BOOLEAN,
    "valueText" TEXT,
    "valueNumber" DECIMAL(18,2),
    "valueDate" TIMESTAMP(3),
    "valueOptions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_custom_field_values_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "crm_custom_field_definitions_key_key" ON "crm_custom_field_definitions"("key");

-- CreateIndex
CREATE INDEX "crm_custom_field_definitions_entityType_isActive_position_idx" ON "crm_custom_field_definitions"("entityType", "isActive", "position");

-- CreateIndex
CREATE INDEX "crm_custom_field_values_leadId_idx" ON "crm_custom_field_values"("leadId");

-- CreateIndex
CREATE INDEX "crm_custom_field_values_fieldId_valueBoolean_idx" ON "crm_custom_field_values"("fieldId", "valueBoolean");

-- CreateIndex
CREATE INDEX "crm_custom_field_values_fieldId_valueNumber_idx" ON "crm_custom_field_values"("fieldId", "valueNumber");

-- CreateIndex
CREATE INDEX "crm_custom_field_values_fieldId_valueText_idx" ON "crm_custom_field_values"("fieldId", "valueText");

-- CreateIndex
CREATE INDEX "crm_custom_field_values_fieldId_valueDate_idx" ON "crm_custom_field_values"("fieldId", "valueDate");

-- CreateIndex
CREATE UNIQUE INDEX "crm_custom_field_values_fieldId_leadId_key" ON "crm_custom_field_values"("fieldId", "leadId");

-- AddForeignKey
ALTER TABLE "crm_custom_field_values" ADD CONSTRAINT "crm_custom_field_values_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "crm_custom_field_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_custom_field_values" ADD CONSTRAINT "crm_custom_field_values_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "crm_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
