# Интеграция Telegram Бота

## Настройка бота

1. **Создайте бота через @BotFather**
   - Откройте Telegram и найдите @BotFather
   - Отправьте команду `/newbot`
   - Следуйте инструкциям
   - Получите токен бота

2. **Обновите .env файл**

   ```
   TELEGRAM_BOT_TOKEN="8671610133:AAHz6hQ_LcLqpjZOUbx4E8XeSsMfb-LS-BY"
   TELEGRAM_ADMIN_ID="7513853992"
   ```

3. **Получите свой Telegram ID**
   - Откройте бота @userinfobot
   - Отправьте любое сообщение
   - Скопируйте ваш ID

## События, отправляемые в Telegram

### 1. Новая регистрация

```
🆕 Новая регистрация

📧 Email: user@example.com
🌍 Город: Москва
📍 Источник: Google
```

### 2. Новый платеж

```
💰 Новый платеж

📧 Email: user@example.com
💵 Сумма: 1000 ₽
⭐ Баллы: 10000
```

### 3. Установка приложения

```
📱 Установка приложения

📧 Email: user@example.com
```

## Расширение функционала бота

Если нужно добавить команды для бота, обновите `telegram.service.ts`:

```typescript
// В конструкторе добавьте:
if (token) {
  this.bot = new TelegramBot(token, { polling: true });
  this.setupCommands();
}

// Добавьте метод:
private setupCommands() {
  this.bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    this.bot.sendMessage(chatId, 'Добро пожаловать в SkySEO!');
  });

  this.bot.onText(/\/stats/, async (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== this.adminId) {
      return;
    }
    // Отправить статистику
  });
}
```

## Тестирование уведомлений

1. **Запустите сервер**

   ```bash
   npm run start:dev
   ```

2. **Зарегистрируйте пользователя**

   ```bash
   curl -X POST http://localhost:3000/auth/register \
     -H "Content-Type: application/json" \
     -d '{"email":"test@test.com","password":"pass123","city":"Москва"}'
   ```

3. **Проверьте Telegram**
   - Вы должны получить уведомление о регистрации

## Дополнительные уведомления

Можно добавить уведомления для:

- Низкого баланса пользователя
- Завершения задачи
- Ошибок в системе
- Подозрительной активности

Пример:

```typescript
async sendLowBalanceAlert(email: string, balance: number) {
  const message = `⚠️ <b>Низкий баланс</b>\n\n` +
    `📧 Email: ${email}\n` +
    `💰 Баланс: ${balance} баллов`;

  await this.sendAdminNotification(message);
}
```

## Форматирование сообщений

Telegram поддерживает HTML разметку:

- `<b>жирный</b>` - **жирный**
- `<i>курсив</i>` - _курсив_
- `<code>код</code>` - `код`
- `<pre>блок кода</pre>` - блок кода
- `<a href="url">ссылка</a>` - [ссылка](url)

## Отправка в группу/канал

Если нужно отправлять в группу вместо личных сообщений:

1. Добавьте бота в группу
2. Сделайте его администратором
3. Получите ID группы (начинается с `-`)
4. Обновите `TELEGRAM_ADMIN_ID` на ID группы

## Webhook вместо polling

Для production рекомендуется использовать webhook:

```typescript
// В telegram.service.ts
constructor(private configService: ConfigService) {
  const token = this.configService.get('TELEGRAM_BOT_TOKEN');
  const webhookUrl = this.configService.get('TELEGRAM_WEBHOOK_URL');

  if (token && webhookUrl) {
    this.bot = new TelegramBot(token);
    this.bot.setWebHook(`${webhookUrl}/telegram/webhook`);
  }
}

// Добавьте endpoint в telegram.controller.ts
@Post('webhook')
async handleWebhook(@Body() update: any) {
  this.bot.processUpdate(update);
  return { ok: true };
}
```
