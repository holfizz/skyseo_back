-- CreateEnum
CREATE TYPE "UserType" AS ENUM ('MARKETER', 'SEO', 'ENTREPRENEUR', 'STARTUP');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "userType" "UserType";
