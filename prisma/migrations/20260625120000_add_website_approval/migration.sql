-- Add website approval/restriction flags
ALTER TABLE "websites" ADD COLUMN IF NOT EXISTS "isApproved" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "websites" ADD COLUMN IF NOT EXISTS "isRestricted" BOOLEAN NOT NULL DEFAULT false;

-- Existing websites that already have tasks are considered approved
UPDATE "websites" SET "isApproved" = true WHERE id IN (SELECT DISTINCT "websiteId" FROM tasks);
