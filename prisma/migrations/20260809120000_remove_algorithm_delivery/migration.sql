-- DropForeignKey
ALTER TABLE "algorithm_assignments" DROP CONSTRAINT "algorithm_assignments_userId_fkey";

-- DropIndex
DROP INDEX "executions_algorithmVersion_createdAt_idx";

-- AlterTable
ALTER TABLE "executions" DROP COLUMN "algorithmVersion";

-- DropTable
DROP TABLE "algorithm_assignments";

-- DropTable
DROP TABLE "algorithm_bundles";

-- DropEnum
DROP TYPE "AlgoBundleStatus";

