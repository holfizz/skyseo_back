# Быстрое исправление ошибки TelegramBot

## Что было исправлено

Ошибка: `TelegramBot is not a constructor`

**Причина:** Неправильный импорт библиотеки `node-telegram-bot-api` в TypeScript/NestJS.

**Было:**

```typescript
import * as TelegramBot from 'node-telegram-bot-api'
```

**Стало:**

```typescript
import TelegramBot = require('node-telegram-bot-api')
```

## Как применить исправление

### Вариант 1: Быстрая пересборка (рекомендуется)

```bash
cd skyseo_back
./REBUILD.sh
```

Этот скрипт:

1. Остановит контейнер backend
2. Пересоберет образ
3. Запустит контейнер
4. Покажет логи

### Вариант 2: Ручная пересборка

```bash
cd skyseo_back

# Остановить контейнер
docker-compose stop backend

# Пересобрать образ
docker-compose build backend

# Запустить контейнер
docker-compose up -d backend

# Проверить логи
docker-compose logs -f backend
```

### Вариант 3: Полная пересборка (если не помогло)

```bash
cd skyseo_back

# Остановить все
docker-compose down

# Удалить образ
docker rmi skyseo_back-backend

# Пересобрать и запустить
docker-compose up -d --build

# Проверить логи
docker-compose logs -f backend
```

## Проверка что все работает

После перезапуска в логах должно быть:

```
✅ Prisma connected to database
✅ Application is running on: http://0.0.0.0:4000
```

Не должно быть:

```
❌ TelegramBot is not a constructor
```

## Тестирование

### 1. Проверить API

```bash
curl http://localhost:4000/v1/api/health
```

Должен вернуть:

```json
{
	"status": "ok",
	"database": "connected"
}
```

### 2. Запустить seed

```bash
docker exec -it skyseo_backend npm run seed
```

Должно создать тестовых пользователей и задачи.

### 3. Войти в приложение

```
Email: lol@lol.lol
Пароль: password123
```

## Если ошибка осталась

### Проверить что файл изменился

```bash
docker exec -it skyseo_backend cat /app/dist/src/telegram/telegram.service.js | grep "require"
```

Должно быть:

```javascript
const TelegramBot = require('node-telegram-bot-api')
```

### Очистить кэш Docker

```bash
docker system prune -a
docker-compose build --no-cache backend
docker-compose up -d backend
```

### Проверить версию библиотеки

```bash
docker exec -it skyseo_backend npm list node-telegram-bot-api
```

Должно быть: `node-telegram-bot-api@0.61.0` или выше

## Дополнительная информация

### Почему это произошло

TypeScript/NestJS использует CommonJS модули (`module: "commonjs"` в tsconfig.json), а `node-telegram-bot-api` экспортирует default export.

При использовании `import * as TelegramBot` TypeScript пытается импортировать namespace, но библиотека экспортирует конструктор напрямую.

Правильный способ для CommonJS:

```typescript
import TelegramBot = require('node-telegram-bot-api')
```

Или с esModuleInterop:

```typescript
import TelegramBot from 'node-telegram-bot-api'
```

Но в NestJS с CommonJS лучше использовать `require()`.

### Альтернативное решение

Можно было бы изменить на:

```typescript
const TelegramBot = require('node-telegram-bot-api')
```

Но TypeScript не будет знать типы. С `import TelegramBot = require()` типы работают корректно.

## Полезные команды

```bash
# Проверить статус контейнеров
docker-compose ps

# Перезапустить только backend
docker-compose restart backend

# Войти в контейнер
docker exec -it skyseo_backend sh

# Проверить логи
docker-compose logs backend --tail=100

# Проверить ошибки
docker-compose logs backend | grep ERROR
```
