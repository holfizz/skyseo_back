-- Массив ролей у пользователя. СТРОГО АДДИТИВНО: старое поле "role" остаётся и продолжает
-- работать как раньше — его читают Electron-приложение и весь старый код.
--
-- Контракт: role ВСЕГДА равна roles[0] («главная» роль). Поддерживается в UsersService.setRoles().
-- Поэтому даже если что-то не обновится — старая логика видит осмысленное значение и не ломается.

-- 1. Новая колонка, по умолчанию пустой массив.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "roles" "Role"[] DEFAULT ARRAY[]::"Role"[];

-- 2. Заполняем существующих: roles = [role]. Идемпотентно — только там, где ещё пусто.
UPDATE "users"
SET "roles" = ARRAY["role"]::"Role"[]
WHERE "roles" IS NULL OR cardinality("roles") = 0;

-- 3. Индекс для выборки сотрудников (WHERE roles && ARRAY['MANAGER','SMM']).
--    GIN — стандарт для поиска по массиву.
CREATE INDEX IF NOT EXISTS "users_roles_idx" ON "users" USING GIN ("roles");
