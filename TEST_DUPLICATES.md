# Тест проверки дубликатов

## Проверка дубликатов сайтов

### Тест 1: Создание сайта

```bash
curl -X POST http://localhost:3000/websites \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "name": "Тестовый сайт",
    "url": "https://example.com"
  }'
```

**Ожидаемый результат:** Сайт успешно создан

### Тест 2: Попытка создать дубликат сайта

```bash
curl -X POST http://localhost:3000/websites \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "name": "Другое название",
    "url": "https://example.com"
  }'
```

**Ожидаемый результат:** Ошибка 400 с сообщением "Сайт с таким URL уже существует в вашем списке"

---

## Проверка дубликатов ключевиков

### Тест 3: Создание ключевика

```bash
curl -X POST http://localhost:3000/tasks \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "websiteId": "WEBSITE_ID",
    "keyword": "купить iphone",
    "type": "SEARCH_AND_VISIT",
    "maxYandexVisits": 5,
    "maxGoogleVisits": 5
  }'
```

**Ожидаемый результат:** Ключевик успешно создан

### Тест 4: Попытка создать дубликат ключевика

```bash
curl -X POST http://localhost:3000/tasks \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "websiteId": "WEBSITE_ID",
    "keyword": "купить iphone",
    "type": "SEARCH_AND_VISIT",
    "maxYandexVisits": 5,
    "maxGoogleVisits": 5
  }'
```

**Ожидаемый результат:** Ошибка 400 с сообщением "Ключевое слово "купить iphone" уже существует для этого сайта"

---

## Проверка лимитов накруток

### Тест 5: Проверка дефолтных значений

При создании нового ключевика через UI:

- maxYandexVisits должен быть = 5
- maxGoogleVisits должен быть = 5

### Тест 6: Проверка максимальных значений

При попытке установить значение > 20:

- Значение автоматически ограничивается до 20
- Отображается подсказка "макс. 20"

---

## Изменения в коде

### Backend (skyseo_back/src/websites/websites.service.ts)

✅ Добавлена проверка на существующий URL у пользователя
✅ Возвращается BadRequestException при дубликате

### Backend (skyseo_back/src/tasks/tasks.service.ts)

✅ Добавлена проверка на существующий ключевик для сайта
✅ Возвращается BadRequestException с понятным сообщением

### Frontend (skyseo_app/src/renderer/components/modals/AddKeywordModal.tsx)

✅ Дефолтное значение изменено с 20 на 5
✅ Добавлено ограничение max={20}
✅ Добавлена валидация при вводе
✅ Добавлена подсказка "макс. 20"

### Frontend (skyseo_app/src/renderer/components/modals/KeywordSettingsModal.tsx)

✅ Добавлено ограничение max={20}
✅ Добавлена валидация при вводе
✅ Обновлена подсказка "по умолчанию: 5, макс: 20"
