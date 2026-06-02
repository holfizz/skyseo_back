-- Статус приложения у пользователя: enum AppStatus.
-- Миграция идемпотентна и работает на двух состояниях БД:
--   - prod: колонки "appStatus" нет → добавляем сразу как enum;
--   - dev:  "appStatus" уже есть как VARCHAR (lowercase) → нормализуем значения и меняем тип.
-- "appLastLoginAt" уже добавлен ранее в 1780430548_add_app_tracking — здесь не трогаем.

-- 1. Тип enum (идемпотентно)
DO $$ BEGIN
  CREATE TYPE "AppStatus" AS ENUM ('NEVER', 'ACTIVE', 'UNINSTALLED', 'REINSTALLED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- 2. Колонка "appStatus"
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'appStatus'
  ) THEN
    ALTER TABLE "users" ALTER COLUMN "appStatus" DROP DEFAULT;
    ALTER TABLE "users"
      ALTER COLUMN "appStatus" TYPE "AppStatus"
      USING (
        CASE upper(trim("appStatus"::text))
          WHEN 'ACTIVE'      THEN 'ACTIVE'
          WHEN 'UNINSTALLED' THEN 'UNINSTALLED'
          WHEN 'REINSTALLED' THEN 'REINSTALLED'
          ELSE 'NEVER'
        END
      )::"AppStatus";
    ALTER TABLE "users" ALTER COLUMN "appStatus" SET DEFAULT 'NEVER';
    ALTER TABLE "users" ALTER COLUMN "appStatus" SET NOT NULL;
  ELSE
    ALTER TABLE "users" ADD COLUMN "appStatus" "AppStatus" NOT NULL DEFAULT 'NEVER';
  END IF;
END $$;
