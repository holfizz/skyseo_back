# Интеграция Desktop приложения с Backend

## 🎯 Основная логика

Desktop приложение **НЕ** рассчитывает баллы. Оно только:

1. Получает задачи от backend
2. Выполняет их
3. Отправляет результат (найдено/не найдено)

**Backend сам рассчитывает и начисляет/списывает баллы!**

## 🔄 Цикл работы приложения

### 1. Авторизация

```typescript
// Логин пользователя
const response = await fetch('http://api.skyseo.com/auth/login', {
	method: 'POST',
	headers: { 'Content-Type': 'application/json' },
	body: JSON.stringify({
		email: 'user@example.com',
		password: 'password123',
	}),
})

const { token, user } = await response.json()
// Сохраните token для всех последующих запросов
```

### 2. Получение задачи (каждые 30 минут)

```typescript
// Автоматическое получение задач
setInterval(
	async () => {
		const task = await fetch('http://api.skyseo.com/tasks/available', {
			headers: { Authorization: `Bearer ${token}` },
		}).then(r => r.json())

		if (task) {
			await executeTask(task)
		}
	},
	30 * 60 * 1000,
) // 30 минут
```

### 3. Начало выполнения

```typescript
async function executeTask(task) {
	// Уведомляем backend о начале
	const execution = await fetch('http://api.skyseo.com/executions/start', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${token}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ taskId: task.id }),
	}).then(r => r.json())

	// Выполняем задачу
	const result = await performTask(task)

	// Отправляем результат
	await completeExecution(execution.id, result)
}
```

### 4. Выполнение задачи

```typescript
async function performTask(task) {
	const startTime = Date.now()
	let foundInTop = false
	let position = null
	let pagesVisited = 0

	if (task.type === 'SEARCH_KEYWORD') {
		// Поиск по ключевому слову

		// 1. Открываем Яндекс/Google
		await openBrowser()

		// 2. Ищем по ключевому слову
		await searchFor(task.keyword)

		// 3. Переходим на случайный сайт из выдачи
		await visitRandomSite()
		pagesVisited += randomInt(2, 4)

		// 4. Снова переходим на случайный сайт
		await visitRandomSite()
		pagesVisited += randomInt(2, 3)

		// 5. Ищем целевой сайт в выдаче
		const searchResults = await getSearchResults()
		const targetSite = searchResults.find(r => r.url.includes(task.website.url))

		if (targetSite && targetSite.position <= 50) {
			foundInTop = true
			position = targetSite.position

			// 6. Переходим на целевой сайт
			await visitSite(targetSite.url)
			pagesVisited += randomInt(2, 4)
		}
	} else if (task.type === 'EXTERNAL_LINK') {
		// Переход по внешней ссылке

		// 1. Открываем сайт-донор
		await openBrowser()
		await visitSite(task.externalUrl)

		// 2. Ищем ссылку на целевой сайт
		const link = await findLinkToSite(task.website.url)

		if (link) {
			foundInTop = true // Используем это поле для "ссылка найдена"

			// 3. Кликаем по ссылке
			await clickLink(link)
			pagesVisited += randomInt(2, 4)
		} else {
			foundInTop = false
			pagesVisited = 1 // Только донор
		}
	}

	const duration = Math.floor((Date.now() - startTime) / 1000)

	return {
		foundInTop,
		position,
		pagesVisited,
		duration,
	}
}
```

### 5. Завершение выполнения

```typescript
async function completeExecution(executionId, result) {
	await fetch(`http://api.skyseo.com/executions/${executionId}/complete`, {
		method: 'PUT',
		headers: {
			Authorization: `Bearer ${token}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(result),
	})

	// Backend автоматически:
	// - Рассчитает баллы
	// - Начислит исполнителю +5
	// - Спишет с владельца -10 или -30
	// - Обновит статистику
}
```

## 📊 Типы задач

### SEARCH_KEYWORD (Поиск по ключевому слову)

**Что получает приложение:**

```json
{
	"id": "uuid",
	"type": "SEARCH_KEYWORD",
	"keyword": "купить телефон",
	"website": {
		"url": "example.com"
	},
	"geo": "Москва"
}
```

**Что должно сделать приложение:**

1. Поиск в Яндекс/Google по ключевому слову
2. Посещение 2-3 случайных сайтов из выдачи
3. Поиск целевого сайта в топ-50
4. Если найден - посещение целевого сайта

**Что отправить:**

```json
{
	"foundInTop": true, // Найден ли в топ-50
	"position": 5, // Позиция (1-50)
	"pagesVisited": 7, // Всего страниц
	"duration": 145 // Секунды
}
```

**Баллы (рассчитывает backend):**

- Исполнитель: +5
- Владелец: -30 (если найден) или -10 (если не найден)

### EXTERNAL_LINK (Внешняя ссылка)

**Что получает приложение:**

```json
{
	"id": "uuid",
	"type": "EXTERNAL_LINK",
	"externalUrl": "https://donor-site.com",
	"website": {
		"url": "example.com"
	},
	"geo": "Москва"
}
```

**Что должно сделать приложение:**

1. Открыть сайт-донор (externalUrl)
2. Найти ссылку на целевой сайт (website.url)
3. Если найдена - кликнуть и посетить страницы

**Что отправить:**

```json
{
	"foundInTop": true, // Найдена ли ссылка
	"position": null, // Не используется
	"pagesVisited": 4, // Всего страниц
	"duration": 98 // Секунды
}
```

**Баллы (рассчитывает backend):**

- Исполнитель: +5
- Владелец: -10 (если найдена) или -5 (если не найдена)

## ⚙️ Важные параметры

### Валидация на backend

Приложение должно соблюдать эти правила, иначе backend отклонит:

```typescript
// Минимальная длительность
duration >= 30 // секунд

// Максимальная длительность
duration <= 600 // секунд (10 минут)

// Количество страниц
pagesVisited >= 2 && pagesVisited <= 10

// Позиция (если найдено)
position >= 1 && position <= 50

// Для SEARCH_KEYWORD: если найдено, позиция обязательна
if (foundInTop && type === 'SEARCH_KEYWORD') {
	position !== null
}
```

### Рекомендуемые значения

```typescript
// Длительность
const duration = randomInt(60, 180) // 1-3 минуты

// Страницы
const pagesVisited = randomInt(3, 7) // 3-7 страниц

// Задержки между действиями
const delay = randomInt(2000, 5000) // 2-5 секунд
```

## 🔐 Безопасность

### User-Agent

Приложение должно отправлять реальный User-Agent:

```typescript
const userAgent = navigator.userAgent
// Или для Electron:
const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)...'
```

### IP адрес

Backend автоматически определяет IP адрес из запроса.

### Частота запросов

- Максимум 100 запросов в минуту
- Рекомендуется: 1 задача каждые 30 минут

## 📱 Уведомления пользователю

### Показывать в приложении

```typescript
// Текущий баланс
const profile = await fetch('http://api.skyseo.com/users/profile', {
	headers: { Authorization: `Bearer ${token}` },
}).then(r => r.json())

console.log(`Баланс: ${profile.balance} баллов`)

// История баланса
const history = await fetch('http://api.skyseo.com/users/balance-history', {
	headers: { Authorization: `Bearer ${token}` },
}).then(r => r.json())

// Показать последние операции
history.forEach(item => {
	console.log(
		`${item.amount > 0 ? '+' : ''}${item.amount} - ${item.description}`,
	)
})
```

### Предупреждения

```typescript
if (profile.balance < 100) {
	showNotification('Низкий баланс! Пополните счет.')
}

if (profile.balance < 10) {
	showNotification('Недостаточно баллов для создания задач!')
}
```

## 🎯 Пример полного цикла

```typescript
class SkySEOApp {
	private token: string
	private isRunning: boolean = false

	async start() {
		// 1. Авторизация
		await this.login()

		// 2. Запуск цикла
		this.isRunning = true
		this.mainLoop()
	}

	async login() {
		const response = await fetch('http://api.skyseo.com/auth/login', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				email: this.email,
				password: this.password,
			}),
		})

		const data = await response.json()
		this.token = data.token
	}

	async mainLoop() {
		while (this.isRunning) {
			try {
				// Получить задачу
				const task = await this.getTask()

				if (task) {
					// Выполнить задачу
					await this.executeTask(task)
				}

				// Подождать 30 минут
				await this.sleep(30 * 60 * 1000)
			} catch (error) {
				console.error('Error:', error)
				await this.sleep(60 * 1000) // Подождать минуту при ошибке
			}
		}
	}

	async getTask() {
		const response = await fetch('http://api.skyseo.com/tasks/available', {
			headers: { Authorization: `Bearer ${this.token}` },
		})

		if (response.status === 404) {
			return null // Нет доступных задач
		}

		return response.json()
	}

	async executeTask(task) {
		// Начать выполнение
		const execution = await fetch('http://api.skyseo.com/executions/start', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${this.token}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ taskId: task.id }),
		}).then(r => r.json())

		// Выполнить задачу
		const result = await this.performTask(task)

		// Завершить выполнение
		await fetch(`http://api.skyseo.com/executions/${execution.id}/complete`, {
			method: 'PUT',
			headers: {
				Authorization: `Bearer ${this.token}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(result),
		})

		// Обновить баланс в UI
		await this.updateBalance()
	}

	async performTask(task) {
		// Ваша логика выполнения задачи
		// ...

		return {
			foundInTop: true,
			position: 5,
			pagesVisited: 6,
			duration: 120,
		}
	}

	async updateBalance() {
		const profile = await fetch('http://api.skyseo.com/users/profile', {
			headers: { Authorization: `Bearer ${this.token}` },
		}).then(r => r.json())

		this.showBalance(profile.balance)
	}

	sleep(ms) {
		return new Promise(resolve => setTimeout(resolve, ms))
	}
}
```

## 🚀 Готово!

Теперь ваше приложение:

1. ✅ Получает задачи от backend
2. ✅ Выполняет их
3. ✅ Отправляет только результат
4. ✅ Backend сам рассчитывает баллы
5. ✅ Защищено от накрутки
