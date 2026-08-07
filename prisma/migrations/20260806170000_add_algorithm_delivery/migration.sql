-- CreateEnum
CREATE TYPE "AlgoBundleStatus" AS ENUM ('DRAFT', 'CANARY', 'LIVE', 'ROLLED_BACK');

-- AlterTable
ALTER TABLE "executions" ADD COLUMN     "algorithmVersion" INTEGER;

-- CreateTable
CREATE TABLE "algorithm_bundles" (
    "version" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "notes" TEXT,
    "status" "AlgoBundleStatus" NOT NULL DEFAULT 'DRAFT',
    "floor" INTEGER NOT NULL,
    "minAppVersion" TEXT NOT NULL,
    "bundle" JSONB NOT NULL,
    "sha256" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdByEmail" TEXT,
    "rollbackReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "algorithm_bundles_pkey" PRIMARY KEY ("version")
);

-- CreateTable
CREATE TABLE "algorithm_assignments" (
    "userId" TEXT NOT NULL,
    "appliedVersion" INTEGER,
    "pinnedVersion" INTEGER,
    "appVersion" TEXT,
    "lastError" TEXT,
    "reportedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "algorithm_assignments_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "algorithm_bundles_status_version_idx" ON "algorithm_bundles"("status", "version");

-- CreateIndex
CREATE INDEX "algorithm_assignments_appliedVersion_idx" ON "algorithm_assignments"("appliedVersion");

-- CreateIndex
CREATE INDEX "executions_algorithmVersion_createdAt_idx" ON "executions"("algorithmVersion", "createdAt");

-- AddForeignKey
ALTER TABLE "algorithm_assignments" ADD CONSTRAINT "algorithm_assignments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

