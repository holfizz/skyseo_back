-- Бэкфилл реферальных кодов для юзеров, зарегистрированных до генерации кода.
-- Формат как при регистрации: 8 hex-символов в верхнем регистре (randomBytes(4)).
-- referralCode @unique → проверяем уникальность и ретраим при коллизии.
-- Внутри одной транзакции уже присвоенные в цикле коды видны через EXISTS.
DO $$
DECLARE
  u RECORD;
  new_code TEXT;
BEGIN
  FOR u IN SELECT id FROM "users" WHERE "referralCode" IS NULL LOOP
    LOOP
      new_code := upper(substring(md5(random()::text || clock_timestamp()::text || u.id) for 8));
      EXIT WHEN NOT EXISTS (SELECT 1 FROM "users" WHERE "referralCode" = new_code);
    END LOOP;
    UPDATE "users" SET "referralCode" = new_code WHERE id = u.id;
  END LOOP;
END $$;
