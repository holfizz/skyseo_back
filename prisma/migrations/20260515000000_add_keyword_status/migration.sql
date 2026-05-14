-- CreateEnum
CREATE TYPE "KeywordRestrictionStatus" AS ENUM ('ACTIVE', 'RESTRICTED');

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN "keywordStatus" "KeywordRestrictionStatus" NOT NULL DEFAULT 'ACTIVE';
