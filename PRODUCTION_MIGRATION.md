# Миграция базы данных на Production

## ⚠️ ВАЖНО: Перед миграцией на production

1. **Сделайте бэкап базы данных!**

   ```bash
   pg_dump -U postgres -d skyseo_prod > backup_$(date +%Y%m%d_%H%M%S).sql
   ```

2. **Проверьте, что все миграции применены локально**
   ```bash
   npx prisma migrate status
   ```

## Применение миграций на production

### Вариант 1: Через Prisma Migrate (рекомендуется)

```bash
# 1. Подключитесь к production серверу
ssh user@production-server

# 2. Перейдите в папку проекта
cd /path/to/skyseo_back

# 3. Примените миграции
npx prisma migrate deploy

# 4. Проверьте статус
npx prisma migrate status
```

### Вариант 2: Вручную через SQL

```bash
# 1. Скопируйте файл миграции на сервер
scp prisma/migrations/20260423121920_init/migration.sql user@production-server:/tmp/

# 2. Подключитесь к production базе данных
psql -U postgres -d skyseo_prod

# 3. Выполните миграцию
\i /tmp/migration.sql

# 4. Зарегистрируйте миграцию в Prisma
INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES (
  gen_random_uuid(),
  'checksum_here',
  NOW(),
  '20260423121920_init',
  NULL,
  NULL,
  NOW(),
  1
);
```

## После миграции

1. **Проверьте структуру таблиц**

   ```sql
   \dt
   SELECT * FROM app_versions LIMIT 1;
   ```

2. **Проверьте, что приложение работает**

   ```bash
   # Перезапустите backend
   pm2 restart skyseo-backend

   # Проверьте логи
   pm2 logs skyseo-backend
   ```

3. **Добавьте тестовую версию для проверки Force Update**
   ```bash
   psql -U postgres -d skyseo_prod < test-force-update.sql
   ```

## Откат миграции (если что-то пошло не так)

```bash
# 1. Восстановите бэкап
psql -U postgres -d skyseo_prod < backup_YYYYMMDD_HHMMSS.sql

# 2. Или откатите последнюю миграцию
npx prisma migrate resolve --rolled-back 20260423121920_init
```

## Проверка после деплоя

1. Проверьте endpoint версий:

   ```bash
   curl "https://skyseo.site/v1/api/app-version/check?version=1.0.0&platform=darwin-arm64"
   ```

2. Ожидаемый ответ:
   ```json
   {
   	"updateRequired": false,
   	"updateAvailable": false,
   	"currentVersion": "1.0.0"
   }
   ```

## Чеклист для production

- [ ] Бэкап базы данных создан
- [ ] Миграции применены успешно
- [ ] Backend перезапущен
- [ ] Endpoint `/app-version/check` работает
- [ ] Логи не показывают ошибок
- [ ] Тестовое приложение запускается без блокировки
- [ ] Force Update работает (если добавлена тестовая версия)
