# SkySEO Backend

Backend API для системы обмена посещениями сайтов SkySEO.

## Технологии

- NestJS
- Prisma ORM
- PostgreSQL
- JWT Authentication
- YooKassa (платежи)
- Telegram Bot API
- Nodemailer

## Установка

1. Установите зависимости:

```bash
npm install
```

2. Создайте файл `.env` на основе `.env.example`:

```bash
cp .env.example .env
```

3. Настройте переменные окружения в `.env`:

- DATABASE_URL - строка подключения к PostgreSQL
- JWT_SECRET - секретный ключ для JWT
- TELEGRAM_BOT_TOKEN - токен Telegram бота
- SMTP настройки для email
- YooKassa credentials

4. Создайте базу данных PostgreSQL:

```bash
createdb skyseo
```

5. Примените миграции:

```bash
npm run prisma:migrate
```

6. Сгенерируйте Prisma Client:

```bash
npm run prisma:generate
```

## Запуск

### Development

```bash
npm run start:dev
```

### Production

```bash
npm run build
npm run start:prod
```

## API Endpoints

### Авторизация

- `POST /auth/register` - Регистрация
- `POST /auth/login` - Вход

### Пользователи

- `GET /users/profile` - Профиль пользователя
- `GET /users/balance-history` - История баланса

### Сайты

- `POST /websites` - Добавить сайт
- `GET /websites` - Список сайтов
- `GET /websites/:id` - Получить сайт
- `PUT /websites/:id` - Обновить сайт
- `DELETE /websites/:id` - Удалить сайт

### Задачи

- `POST /tasks` - Создать задачу
- `GET /tasks/my` - Мои задачи
- `GET /tasks/available` - Получить задачу для выполнения

### Выполнение задач

- `POST /executions/start` - Начать выполнение
- `PUT /executions/:id/complete` - Завершить выполнение
- `GET /executions/history` - История выполнений

### Статистика

- `GET /statistics/website/:id` - Статистика сайта
- `GET /statistics/admin` - Админ статистика

### Платежи

- `POST /payments` - Создать платеж
- `GET /payments/history` - История платежей
- `POST /payments/webhook` - Webhook YooKassa
- `GET /payments/:id/status` - Статус платежа

## Система баллов

### Заработок баллов

- Выполнение задачи: **+5 баллов**
- Приветственный бонус: **+5000 баллов**

### Расход баллов

- Поиск по ключевому слову (сайт в топ-50): **-30 баллов**
- Поиск по ключевому слову (сайт не найден): **-10 баллов**
- Переход по внешней ссылке (ссылка найдена): **-10 баллов**
- Переход по внешней ссылке (ссылка не найдена): **-5 баллов**

## База данных

### Основные таблицы

- `users` - Пользователи
- `websites` - Сайты пользователей
- `tasks` - Задачи для выполнения
- `executions` - Выполнения задач
- `statistics` - Статистика позиций
- `balance_history` - История баланса
- `payments` - Платежи

## Уведомления

### Telegram

Уведомления отправляются админу (ID: 7513853992):

- Новая регистрация
- Новый платеж
- Установка приложения

### Email

Уведомления пользователям:

- Низкий баланс (< 100 баллов)
- Успешный платеж
- Приветственное письмо

## Prisma Studio

Для просмотра и редактирования данных:

```bash
npm run prisma:studio
```

## Разработка

### Создание новой миграции

```bash
npx prisma migrate dev --name migration_name
```

### Сброс базы данных

```bash
npx prisma migrate reset
```
# skyseo_back
