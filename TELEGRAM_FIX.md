# Telegram Bot Fix - Полностью опциональный бот

## Проблема

Приложение падало с ошибкой `ETIMEDOUT` при попытке подключения к Telegram API, даже когда токен был невалидным или сеть недоступна.

## Решение

1. **Удалили `nestjs-telegraf`** - больше не используем интеграцию NestJS
2. **Прямое использование `telegraf`** - создаем бота вручную в сервисе
3. **Асинхронная инициализация с таймаутом** - бот инициализируется в фоне с таймаутом 5 секунд
4. **Graceful degradation** - если бот не подключился, приложение продолжает работать без уведомлений

## Изменения

### telegram.module.ts

- Убрали `TelegrafModule.forRootAsync()`
- Модуль теперь просто регистрирует сервис без зависимостей от Telegraf

### telegram.service.ts

- Убрали `@InjectBot()` декоратор
- Создаем `new Telegraf(token)` вручную
- Метод `initializeBot()` с try-catch и таймаутом 5 секунд
- Если подключение не удалось - просто логируем и продолжаем работу

### package.json

- Удалили `nestjs-telegraf` из dependencies
- Оставили только `telegraf`

## Команды для обновления на сервере

```bash
# 1. Остановить контейнеры
docker-compose down

# 2. Пересобрать backend с новыми зависимостями
docker-compose build --no-cache backend

# 3. Запустить
docker-compose up -d

# 4. Проверить логи
docker-compose logs -f backend
```

## Ожидаемое поведение

### С валидным токеном и доступом к Telegram API:

```
⚠️ Telegram module loaded (bot initialization deferred to service)
✅ Telegram bot connected successfully
🚀 Server running on http://localhost:4000/v1/api
```

### Без токена или с проблемами подключения:

```
⚠️ Telegram module loaded (bot initialization deferred to service)
⚠️ Telegram notifications disabled (no valid token)
🚀 Server running on http://localhost:4000/v1/api
```

или

```
⚠️ Telegram module loaded (bot initialization deferred to service)
⚠️ Telegram bot connection failed: Connection timeout
⚠️ Telegram notifications disabled
🚀 Server running on http://localhost:4000/v1/api
```

## Важно

- Приложение **НЕ падает** если Telegram недоступен
- Все уведомления просто логируются в консоль: `[Telegram disabled]: <message>`
- Можно работать полностью без Telegram бота
