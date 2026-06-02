-- AddColumn appStatus и appLastLoginAt к User
ALTER TABLE "users" 
ADD COLUMN IF NOT EXISTS "appStatus" VARCHAR(50) NOT NULL DEFAULT 'never',
ADD COLUMN IF NOT EXISTS "appLastLoginAt" TIMESTAMP(3);
