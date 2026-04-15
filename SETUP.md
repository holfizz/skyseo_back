# Инструкция по настройке SkySEO Backend

## 1. Установка PostgreSQL

### macOS (через Homebrew)

```bash
brew install postgresql@15
brew services start postgresql@15
```

### Или используйте Postgres.app

Скачайте с https://postgresapp.com/

## 2. Создание базы данных

```bash
# Подключитесь к PostgreSQL
psql postgres

# Создайте базу данных
CREATE DATABASE skyseo;

# Создайте пользователя (опционально)
CREATE USER skyseo_user WITH PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE skyseo TO skyseo_user;

# Выход
\q
```

## 3. Настройка .env файла

Файл `.env` уже создан. Обновите следующие параметры:

### База данных

Если используете другие credentials:

```
DATABASE_URL="postgresql://username:password@localhost:5432/skyseo?schema=public"
```

### Email (для уведомлений)

Для Gmail нужно создать App Password:

1. Перейдите в Google Account → Security
2. Включите 2-Step Verification
3. Создайте App Password
4. Используйте его в SMTP_PASSWORD

### YooKassa

1. Зарегистрируйтесь на https://yookassa.ru/
2. Получите Shop ID и Secret Key
3. Обновите в .env

## 4. Применение миграций

```bash
npx prisma migrate dev --name init
```

Эта команда:

- Создаст все таблицы в базе данных
- Применит миграции
- Сгенерирует Prisma Client

## 5. Запуск сервера

### Development режим

```bash
npm run start:dev
```

Сервер запустится на http://localhost:3000

### Production режим

```bash
npm run build
npm run start:prod
```

## 6. Проверка работы

### Тест регистрации

```bash
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "password123",
    "city": "Москва",
    "referralSource": "Google"
  }'
```

### Тест логина

```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "password123"
  }'
```

## 7. Просмотр данных

Запустите Prisma Studio для визуального просмотра данных:

```bash
npm run prisma:studio
```

Откроется на http://localhost:5555

## 8. Создание первого админа

После регистрации обычного пользователя, сделайте его админом через Prisma Studio:

1. Откройте таблицу `users`
2. Найдите нужного пользователя
3. Измените поле `role` на `ADMIN`

Или через SQL:

```sql
UPDATE users SET role = 'ADMIN' WHERE email = 'admin@example.com';
```

## Структура API

Все endpoints требуют JWT токен в заголовке (кроме auth):

```
Authorization: Bearer YOUR_JWT_TOKEN
```

### Основные endpoints:

- `POST /auth/register` - Регистрация
- `POST /auth/login` - Вход
- `GET /users/profile` - Профиль
- `POST /websites` - Добавить сайт
- `POST /tasks` - Создать задачу
- `GET /tasks/available` - Получить задачу для выполнения
- `POST /executions/start` - Начать выполнение
- `PUT /executions/:id/complete` - Завершить выполнение
- `GET /statistics/website/:id` - Статистика сайта
- `POST /payments` - Создать платеж

## Troubleshooting

### Ошибка подключения к БД

Проверьте что PostgreSQL запущен:

```bash
brew services list
```

### Ошибка миграций

Сбросьте базу данных:

```bash
npx prisma migrate reset
```

### Порт занят

Измените PORT в .env файле

## Следующие шаги

1. Настройте SMTP для email уведомлений
2. Настройте YooKassa для приема платежей
3. Проверьте работу Telegram бота
4. Создайте тестовые данные
5. Подключите frontend приложение
