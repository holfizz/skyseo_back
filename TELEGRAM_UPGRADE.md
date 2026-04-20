# Обновление на nestjs-telegraf

## Что изменилось

Заменили `node-telegram-bot-api` на официальную интеграцию `nestjs-telegraf` + `telegraf`.

### Преимущества nestjs-telegraf

✅ **Официальная интеграция** - разработана специально для NestJS
✅ **Dependency Injection** - полная поддержка DI из коробки
✅ **TypeScript** - отличная типизация
✅ **Декораторы** - можно создавать команды через декораторы
✅ **Middleware** - поддержка middleware для обработки сообщений
✅ **Нет проблем с импортами** - работает из коробки

### Было (node-telegram-bot-api)

```typescript
import TelegramBot = require('node-telegram-bot-api')

constructor(private configService: ConfigService) {
  const token = this.configService.get('TELEGRAM_BOT_TOKEN')
  this.bot = new TelegramBot(token, { polling: false })
}

await this.bot.sendMessage(this.adminId, message)
```

### Стало (nestjs-telegraf)

```typescript
import { InjectBot } from 'nestjs-telegraf'
import { Telegraf } from 'telegraf'

constructor(
  @InjectBot() private readonly bot: Telegraf,
  private configService: ConfigService,
) {}

await this.bot.telegram.sendMessage(this.adminId, message)
```

## Установка

### 1. Обновить зависимости

Уже обновлено в `package.json`:

```json
{
	"dependencies": {
		"nestjs-telegraf": "^2.7.0",
		"telegraf": "^4.15.0"
	}
}
```

### 2. Установить в Docker

```bash
cd skyseo_back
docker-compose exec backend npm install
```

Или пересобрать образ:

```bash
docker-compose build backend
docker-compose up -d backend
```

## Конфигурация

### TelegramModule

```typescript
TelegrafModule.forRootAsync({
	imports: [ConfigModule],
	useFactory: (configService: ConfigService) => ({
		token: configService.get<string>('TELEGRAM_BOT_TOKEN') || 'dummy-token',
		launchOptions: {
			webhook: undefined, // Только для отправки, без polling
		},
	}),
	inject: [ConfigService],
})
```

### Переменные окружения

В `.env`:

```env
TELEGRAM_BOT_TOKEN=your_bot_token_here
TELEGRAM_ADMIN_ID=your_telegram_id
```

Если токен не указан - бот не запустится, но приложение будет работать.

## Использование

### Отправка уведомлений (как раньше)

```typescript
// Регистрация
await this.telegramService.sendRegistrationNotification(
	'user@example.com',
	'Москва',
	'Google',
)

// Платеж
await this.telegramService.sendPaymentNotification(
	'user@example.com',
	1000,
	500,
)

// Жалоба
await this.telegramService.sendComplaintNotification(
	'Текст жалобы',
	'contact@example.com',
	'user@example.com',
)
```

### Добавление команд бота (опционально)

Можно добавить команды для управления через Telegram:

```typescript
import { Update, Ctx, Start, Help, Command } from 'nestjs-telegraf'
import { Context } from 'telegraf'

@Update()
export class TelegramUpdate {
	@Start()
	async start(@Ctx() ctx: Context) {
		await ctx.reply('Привет! Я бот SkySEO')
	}

	@Help()
	async help(@Ctx() ctx: Context) {
		await ctx.reply(
			'Доступные команды:\n/stats - Статистика\n/users - Пользователи',
		)
	}

	@Command('stats')
	async stats(@Ctx() ctx: Context) {
		// Получить статистику из БД
		await ctx.reply('📊 Статистика...')
	}
}
```

Добавить в `telegram.module.ts`:

```typescript
providers: [TelegramService, TelegramUpdate]
```

## Тестирование

### 1. Проверить что бот запустился

```bash
docker-compose logs backend | grep -i telegram
```

Должно быть:

```
✅ Telegram bot initialized
```

### 2. Отправить тестовое уведомление

Через API или напрямую:

```typescript
await this.telegramService.sendAdminNotification('🧪 Тест')
```

### 3. Проверить в Telegram

Сообщение должно прийти админу (TELEGRAM_ADMIN_ID).

## Миграция

### Что НЕ изменилось

- ✅ Все методы сервиса остались такими же
- ✅ API не изменился
- ✅ Контроллеры работают как раньше

### Что изменилось

- ✅ Импорты в `telegram.service.ts`
- ✅ Конфигурация в `telegram.module.ts`
- ✅ Зависимости в `package.json`

## Troubleshooting

### Ошибка: "Bot token is invalid"

Проверьте `TELEGRAM_BOT_TOKEN` в `.env`:

```bash
docker-compose exec backend printenv | grep TELEGRAM
```

### Ошибка: "Cannot inject bot"

Убедитесь что `TelegrafModule` импортирован в `TelegramModule`.

### Бот не отправляет сообщения

1. Проверьте `TELEGRAM_ADMIN_ID`
2. Убедитесь что бот не заблокирован
3. Проверьте логи: `docker-compose logs backend | grep -i telegram`

### Приложение не запускается

Если токен не указан - используется `dummy-token` и бот просто не работает, но приложение запускается нормально.

## Дополнительные возможности

### Webhook вместо polling

Для production можно настроить webhook:

```typescript
TelegrafModule.forRootAsync({
	useFactory: (configService: ConfigService) => ({
		token: configService.get('TELEGRAM_BOT_TOKEN'),
		launchOptions: {
			webhook: {
				domain: 'https://skyseo.site',
				hookPath: '/telegram-webhook',
			},
		},
	}),
})
```

### Middleware для логирования

```typescript
import { Injectable } from '@nestjs/common'
import { Context, Telegraf } from 'telegraf'

@Injectable()
export class TelegramMiddleware {
	use() {
		return async (ctx: Context, next: () => Promise<void>) => {
			console.log('Telegram message:', ctx.message)
			await next()
		}
	}
}
```

### Сцены (Scenes)

Для сложных диалогов:

```typescript
import { Scene, SceneEnter, Command } from 'nestjs-telegraf'

@Scene('registration')
export class RegistrationScene {
	@SceneEnter()
	async enter(@Ctx() ctx: Context) {
		await ctx.reply('Введите email:')
	}

	@Command('cancel')
	async cancel(@Ctx() ctx: Context) {
		await ctx.scene.leave()
	}
}
```

## Документация

- [nestjs-telegraf](https://github.com/bukhalo/nestjs-telegraf)
- [Telegraf](https://telegraf.js.org/)
- [Telegram Bot API](https://core.telegram.org/bots/api)

## Заключение

Переход на `nestjs-telegraf` делает код чище, убирает проблемы с импортами и дает больше возможностей для расширения функционала бота в будущем.
