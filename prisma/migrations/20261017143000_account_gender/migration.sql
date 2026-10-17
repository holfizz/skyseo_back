-- Local outreach setting: Telegram does not expose a gender profile field.
CREATE TYPE "TgAccountGender" AS ENUM ('UNSPECIFIED', 'MALE', 'FEMALE');
ALTER TABLE "tg_accounts" ADD COLUMN "gender" "TgAccountGender" NOT NULL DEFAULT 'UNSPECIFIED';
-- Previously configured personas, identified explicitly (never infer from a name).
UPDATE "tg_accounts" SET "gender" = 'FEMALE' WHERE "tgUserId" IN
('8838034441','8914715508','8648554720','8845358852','8819530321','8937344210');
UPDATE "tg_accounts" SET "gender" = 'MALE' WHERE "tgUserId" IN
('8805547330','8962548920','8546801408','8628244820','8746093692','8832465827',
 '8915027977','8595466968','8578156188','8277512702');
