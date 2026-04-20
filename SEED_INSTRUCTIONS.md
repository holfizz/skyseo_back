# Инструкция по добавлению тестовых заданий

## Быстрый старт

### 1. Запустить seed в Docker контейнере

```bash
docker exec -it skyseo_backend npm run seed
```

Или:

```bash
docker exec -it skyseo_backend npm run prisma:seed
```

## Что создается

### Пользователи

**Пользователь 1:**

- Email: `lol@lol.com`
- Пароль: `password123`
- Баланс: 2500 баллов
- Город: Москва

**Пользователь 2 (с активными задачами):**

- Email: `lol@lol.lol`
- Пароль: `password123`
- Баланс: 5000 баллов
- Город: Москва

### Сайты для lol@lol.com

1. **Интернет-магазин электроники**
   - URL: https://example-electronics.ru
   - Город: Москва

2. **Блог о путешествиях**
   - URL: https://travel-blog.ru
   - Город: Санкт-Петербург

### Сайты для lol@lol.lol (с задачами)

1. **Golden Goose Москва**
   - URL: https://goldengoose.moscow
   - Город: Москва
   - **4 активных задачи:**
     - "купить golden goose москва" (5 Яндекс / 5 Google)
     - "golden goose мск" (4 Яндекс / 4 Google)
     - "голден гус москва" (6 Яндекс / 6 Google)
     - "купить голден гус в москве" (5 Яндекс / 5 Google)

2. **Golden Goose Vercel**
   - URL: https://ggose.vercel.app
   - Город: Москва
   - **2 активных задачи:**
     - "golden goose купить в москве" (5 Яндекс / 5 Google)
     - "golden goose купить в мск" (3 Яндекс / 3 Google)

## Параметры задач

Все задачи настроены с:

- **Тип:** SEARCH_AND_VISIT (поиск + посещение)
- **Стоимость:** 10 баллов
- **Глубина:** 2-5 страниц
- **Время на странице:** 30-180 секунд
- **Активны:** Да
- **Яндекс:** Включен
- **Google:** Включен

## Как использовать

### 1. Войти в приложение

```
Email: lol@lol.lol
Пароль: password123
```

### 2. Проверить задачи

В приложении должны появиться:

- 2 сайта (Golden Goose Москва, Golden Goose Vercel)
- 6 активных задач
- Баланс 5000 баллов

### 3. Запустить выполнение

Нажать кнопку "Запустить" в приложении - задачи начнут выполняться автоматически.

## Проверка в базе данных

### Подключиться к Prisma Studio

```bash
cd skyseo_back
npm run prisma:studio
```

Откроется веб-интерфейс на http://localhost:5555

### Проверить через SQL

```bash
docker exec -it skyseo_postgres psql -U skyseo -d skyseo
```

```sql
-- Проверить пользователей
SELECT id, email, balance FROM users;

-- Проверить сайты
SELECT id, name, url, "userId" FROM websites;

-- Проверить задачи
SELECT id, keyword, "websiteId", "isActive", "maxYandexVisits", "maxGoogleVisits"
FROM tasks
WHERE "isActive" = true;

-- Проверить задачи с сайтами
SELECT
  t.keyword,
  w.name as website,
  w.url,
  t."maxYandexVisits",
  t."maxGoogleVisits",
  t."isActive"
FROM tasks t
JOIN websites w ON t."websiteId" = w.id
WHERE t."isActive" = true;
```

## Очистка данных

Если нужно очистить и пересоздать:

```bash
# Удалить все данные
docker exec -it skyseo_backend npx prisma migrate reset --force

# Запустить seed заново
docker exec -it skyseo_backend npm run seed
```

## Добавление своих задач

Отредактируйте `prisma/seed.ts` и добавьте свои задачи:

```typescript
await prisma.task.create({
	data: {
		websiteId: website3.id,
		type: 'SEARCH_AND_VISIT',
		keyword: 'ваш запрос',
		geo: 'Москва',
		pointsCost: 10,
		maxYandexVisits: 5,
		maxGoogleVisits: 5,
		useYandex: true,
		useGoogle: true,
		pagesDepthFrom: 3,
		pagesDepthTo: 5,
		pageDurationFrom: 60,
		pageDurationTo: 180,
		isActive: true,
	},
})
```

Затем запустите seed снова.

## Troubleshooting

### Ошибка "Unknown file extension .ts"

Уже исправлено! Используется `ts-node --transpile-only`

### Ошибка "User already exists"

Seed использует `upsert` - просто обновит существующих пользователей.

### Задачи не появляются в приложении

1. Проверьте что пользователь `lol@lol.lol` (не `lol@lol.com`)
2. Проверьте в базе что задачи `isActive = true`
3. Перезапустите приложение

### Баланс не обновляется

Seed устанавливает баланс при создании. Если пользователь уже существует - баланс не изменится (используется `update: {}`).

Чтобы обновить баланс:

```sql
UPDATE users SET balance = 5000 WHERE email = 'lol@lol.lol';
```

## Мониторинг выполнения

Логи приложения покажут:

```
📋 Выполнение задачи: купить golden goose москва
🔍 Поиск в Яндексе: купить golden goose москва
✅ Поиск выполнен успешно
🎯 Сайт найден на позиции: 3
✅ Задача выполнена успешно
```

## Полезные команды

```bash
# Войти в контейнер
docker exec -it skyseo_backend sh

# Проверить логи
docker logs skyseo_backend -f

# Перезапустить контейнер
docker restart skyseo_backend

# Проверить базу данных
docker exec -it skyseo_postgres psql -U skyseo -d skyseo -c "SELECT COUNT(*) FROM tasks WHERE \"isActive\" = true;"
```
