# SkySEO API Documentation

Base URL: `http://localhost:3000`

## Авторизация

Все защищенные endpoints требуют JWT токен в заголовке:

```
Authorization: Bearer YOUR_JWT_TOKEN
```

---

## Auth Endpoints

### Регистрация

```http
POST /auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123",
  "city": "Москва",
  "referralSource": "Google"
}
```

**Response:**

```json
{
	"user": {
		"id": "uuid",
		"email": "user@example.com",
		"balance": 5000,
		"role": "USER",
		"city": "Москва",
		"referralSource": "Google",
		"createdAt": "2024-01-01T00:00:00.000Z"
	},
	"token": "jwt_token_here"
}
```

### Вход

```http
POST /auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123"
}
```

---

## Users Endpoints

### Получить профиль

```http
GET /users/profile
Authorization: Bearer YOUR_TOKEN
```

### История баланса

```http
GET /users/balance-history
Authorization: Bearer YOUR_TOKEN
```

---

## Websites Endpoints

### Добавить сайт

```http
POST /websites
Authorization: Bearer YOUR_TOKEN
Content-Type: application/json

{
  "url": "https://example.com"
}
```

### Список сайтов

```http
GET /websites
Authorization: Bearer YOUR_TOKEN
```

### Получить сайт

```http
GET /websites/:id
Authorization: Bearer YOUR_TOKEN
```

### Обновить сайт

```http
PUT /websites/:id
Authorization: Bearer YOUR_TOKEN
Content-Type: application/json

{
  "isActive": false
}
```

### Удалить сайт

```http
DELETE /websites/:id
Authorization: Bearer YOUR_TOKEN
```

---

## Tasks Endpoints

### Создать задачу

```http
POST /tasks
Authorization: Bearer YOUR_TOKEN
Content-Type: application/json

{
  "websiteId": "uuid",
  "type": "SEARCH_KEYWORD",
  "keyword": "купить телефон",
  "geo": "Москва"
}
```

Или для внешних ссылок:

```json
{
	"websiteId": "uuid",
	"type": "EXTERNAL_LINK",
	"externalUrl": "https://donor-site.com",
	"geo": "Москва"
}
```

### Мои задачи

```http
GET /tasks/my
Authorization: Bearer YOUR_TOKEN
```

### Получить задачу для выполнения

```http
GET /tasks/available
Authorization: Bearer YOUR_TOKEN
```

**Response:**

```json
{
	"id": "uuid",
	"websiteId": "uuid",
	"type": "SEARCH_KEYWORD",
	"keyword": "купить телефон",
	"geo": "Москва",
	"status": "ASSIGNED",
	"pointsCost": 30,
	"website": {
		"url": "https://example.com"
	}
}
```

---

## Executions Endpoints

### Начать выполнение

```http
POST /executions/start
Authorization: Bearer YOUR_TOKEN
Content-Type: application/json

{
  "taskId": "uuid"
}
```

### Завершить выполнение

```http
PUT /executions/:id/complete
Authorization: Bearer YOUR_TOKEN
Content-Type: application/json

{
  "foundInTop": true,
  "position": 5,
  "pagesVisited": 3,
  "duration": 120
}
```

**Параметры:**

- `foundInTop` - найден ли сайт в топ-50
- `position` - позиция в выдаче (1-50 или null)
- `pagesVisited` - количество посещенных страниц
- `duration` - длительность в секундах

### История выполнений

```http
GET /executions/history
Authorization: Bearer YOUR_TOKEN
```

---

## Statistics Endpoints

### Статистика сайта

```http
GET /statistics/website/:websiteId
Authorization: Bearer YOUR_TOKEN
```

**Response:**

```json
[
	{
		"id": "uuid",
		"websiteId": "uuid",
		"keyword": "купить телефон",
		"position": 5,
		"inTop1": 0,
		"inTop2_3": 0,
		"inTop5": 1,
		"inTop10": 0,
		"inTop50": 0,
		"belowTop50": 0,
		"totalVisits": 10,
		"date": "2024-01-01T00:00:00.000Z"
	}
]
```

---

## Payments Endpoints

### Создать платеж

```http
POST /payments
Authorization: Bearer YOUR_TOKEN
Content-Type: application/json

{
  "amount": 1000,
  "points": 10000
}
```

**Response:**

```json
{
	"id": "uuid",
	"userId": "uuid",
	"amount": 1000,
	"points": 10000,
	"status": "PENDING",
	"confirmationUrl": "https://yookassa.ru/checkout/...",
	"createdAt": "2024-01-01T00:00:00.000Z"
}
```

### История платежей

```http
GET /payments/history
Authorization: Bearer YOUR_TOKEN
```

### Статус платежа

```http
GET /payments/:id/status
Authorization: Bearer YOUR_TOKEN
```

### Webhook YooKassa

```http
POST /payments/webhook
Content-Type: application/json

{
  "event": "payment.succeeded",
  "object": {
    "id": "external_payment_id",
    ...
  }
}
```

---

## Admin Endpoints

Требуют роль ADMIN.

### Общая статистика

```http
GET /admin/statistics
Authorization: Bearer ADMIN_TOKEN
```

**Response:**

```json
{
	"users": {
		"total": 100,
		"active": 95,
		"activeToday": 50,
		"activeNow": 10
	},
	"websites": {
		"total": 150
	},
	"tasks": {
		"total": 1000,
		"pending": 50,
		"completed": 900
	},
	"executions": {
		"total": 5000
	},
	"payments": {
		"total": 200,
		"revenue": 50000
	},
	"balance": {
		"system": 100000
	}
}
```

### Все пользователи

```http
GET /admin/users
Authorization: Bearer ADMIN_TOKEN
```

### Детали пользователя

```http
GET /admin/users/:id
Authorization: Bearer ADMIN_TOKEN
```

### Изменить баланс пользователя

```http
PUT /admin/users/:id/balance
Authorization: Bearer ADMIN_TOKEN
Content-Type: application/json

{
  "amount": 1000,
  "description": "Бонус за активность"
}
```

### Активировать/деактивировать пользователя

```http
PUT /admin/users/:id/toggle-active
Authorization: Bearer ADMIN_TOKEN
```

### Все задачи

```http
GET /admin/tasks
Authorization: Bearer ADMIN_TOKEN
```

### Все выполнения

```http
GET /admin/executions
Authorization: Bearer ADMIN_TOKEN
```

### Все платежи

```http
GET /admin/payments
Authorization: Bearer ADMIN_TOKEN
```

### Активные пользователи сейчас

```http
GET /admin/active-users
Authorization: Bearer ADMIN_TOKEN
```

---

## Система баллов

### Заработок

- Выполнение задачи: **+5 баллов**
- Приветственный бонус: **+5000 баллов**

### Расход

**Поиск по ключевому слову:**

- Сайт в топ-50: **-30 баллов**
- Сайт не найден: **-10 баллов**

**Переход по внешней ссылке:**

- Ссылка найдена: **-10 баллов**
- Ссылка не найдена: **-5 баллов**

---

## Коды ошибок

- `400` - Bad Request (неверные данные)
- `401` - Unauthorized (не авторизован)
- `403` - Forbidden (нет доступа)
- `404` - Not Found (не найдено)
- `409` - Conflict (конфликт, например email уже существует)
- `500` - Internal Server Error

---

## Примеры использования

### Полный цикл работы пользователя

1. **Регистрация**

```bash
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"user@test.com","password":"pass123","city":"Москва"}'
```

2. **Добавление сайта**

```bash
curl -X POST http://localhost:3000/websites \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://mysite.com"}'
```

3. **Создание задачи**

```bash
curl -X POST http://localhost:3000/tasks \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"websiteId":"WEBSITE_ID","type":"SEARCH_KEYWORD","keyword":"купить телефон","geo":"Москва"}'
```

4. **Получение задачи для выполнения**

```bash
curl -X GET http://localhost:3000/tasks/available \
  -H "Authorization: Bearer YOUR_TOKEN"
```

5. **Начало выполнения**

```bash
curl -X POST http://localhost:3000/executions/start \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"taskId":"TASK_ID"}'
```

6. **Завершение выполнения**

```bash
curl -X PUT http://localhost:3000/executions/EXECUTION_ID/complete \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"foundInTop":true,"position":5,"pagesVisited":3,"duration":120}'
```

7. **Просмотр статистики**

```bash
curl -X GET http://localhost:3000/statistics/website/WEBSITE_ID \
  -H "Authorization: Bearer YOUR_TOKEN"
```
