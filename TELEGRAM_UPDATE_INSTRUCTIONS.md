# Инструкция по обновлению Telegram бота

## Что исправлено

- Приложение больше НЕ падает при проблемах с Telegram API
- Бот инициализируется асинхронно с таймаутом 5 секунд
- Если подключение не удалось - приложение работает без уведомлений
- Удалена зависимость `nestjs-telegraf`, используется только `telegraf` напрямую

## Команды для обновления на сервере

### Вариант 1: Быстрое обновление

```bash
cd skyseo_back
docker-compose down
docker-compose build --no-cache backend
docker-compose up -d
docker-compose logs -f backend
```

### Вариант 2: Полная очистка (используйте скрипт)

```bash
cd skyseo_back
chmod +x CLEAN_REBUILD.sh
./CLEAN_REBUILD.sh
```

## Проверка результата

После запуска вы должны увидеть:

```
⚠️ Telegram module loaded (bot initialization deferred to service)
⚠️ Telegram bot connection failed: Connection timeout
⚠️ Telegram notifications disabled
🚀 Server running on http://localhost:4000/v1/api
```

**Главное**: приложение НЕ должно падать с ошибкой `ETIMEDOUT` и должно продолжить работу!

## Если нужно включить Telegram бота

1. Убедитесь что токен валидный в `.env.production`
2. Проверьте что сервер имеет доступ к `api.telegram.org`
3. Пересоберите контейнер

Если все ОК, увидите:

```
✅ Telegram bot connected successfully
```
