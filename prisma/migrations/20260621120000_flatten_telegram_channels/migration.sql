-- Flatten telegram channels: remove campaign grouping, add per-channel fields
-- Existing channel rows are preserved; campaignId is dropped after unlinking.

-- 1. Add new columns (all nullable / with defaults so no existing rows break)
ALTER TABLE telegram_ad_channels
  ADD COLUMN IF NOT EXISTS "postText"  TEXT,
  ADD COLUMN IF NOT EXISTS "promoCode" TEXT,
  ADD COLUMN IF NOT EXISTS "postedAt"  TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "isActive"  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW();

-- 2. Drop the FK constraint
ALTER TABLE telegram_ad_channels
  DROP CONSTRAINT IF EXISTS "telegram_ad_channels_campaignId_fkey";

-- 3. Drop the index on campaignId
DROP INDEX IF EXISTS "telegram_ad_channels_campaignId_idx";

-- 4. Drop the campaignId column
ALTER TABLE telegram_ad_channels
  DROP COLUMN IF EXISTS "campaignId";

-- 5. Drop the campaigns table (data loss intentional — campaigns are being abolished)
DROP TABLE IF EXISTS telegram_ad_campaigns;
