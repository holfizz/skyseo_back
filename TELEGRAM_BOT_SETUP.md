# Telegram Bot Setup & Features

## 🤖 Bot Information

- **Token**: `8671610133:AAHz6hQ_LcLqpjZOUbx4E8XeSsMfb-LS-BY`
- **Admin ID**: `7513853992`

## 📋 Setup Instructions

### 1. Start the Bot (REQUIRED FIRST STEP)

The admin must start the bot before receiving notifications:

1. Open Telegram
2. Search for your bot using the token or bot username
3. Send `/start` command
4. You should receive a welcome message

### 2. Restart Backend

After starting the bot, restart the backend container:

```bash
ssh skyseo@5.35.80.127 "cd ~/skyseo_back && docker-compose restart"
```

## 🎯 Available Commands

### `/start`

Welcome message with list of available commands

### `/stats`

Comprehensive platform statistics:

- **Users**: Total, active (7 days), executors
- **App Versions**: Distribution of users by app version
- **Tasks**: Total created, active, completed, Yandex/Google breakdown
- **Finances**: Total earned points, payments count, total revenue

### `/daily`

Daily statistics (today only):

- New users registered today
- New tasks created today
- Tasks completed today
- Payments received today
- Revenue earned today
- Active executors today

## 📬 Automatic Notifications

### 1. Registration Notifications

Sent when a new user registers:

- Email
- City
- Referral source
- IP address
- Initial balance
- Timestamp

### 2. Payment Notifications

Sent when a payment is successful:

- User email
- Payment amount (₽)
- Points credited
- Timestamp

### 3. App Install Notifications

Sent when user installs the app:

- User email
- App version
- Timestamp

### 4. Complaint Notifications

Sent when user submits a complaint:

- Complaint text
- User email (if logged in)
- Contact info

### 5. Contact Form Notifications

Sent when someone submits contact form:

- Name
- Email
- Phone
- Message

## 🔧 Technical Details

### Webhook Endpoint

Payment webhook is configured at:

```
POST https://skyseo.site/api/payments/webhook
```

### Payment Flow

1. User creates payment → `createPayment()`
2. YooKassa redirects user to payment page
3. User completes payment
4. YooKassa sends webhook to backend
5. Backend processes webhook → `handleYooKassaWebhook()`
6. Backend updates payment status to `SUCCEEDED`
7. Backend credits points to user balance
8. Backend sends Telegram notification
9. Backend sends email notification

### Statistics Queries

The bot uses optimized Prisma queries with parallel execution:

- User counts and grouping by app version
- Task counts with filters (active, completed, Yandex/Google)
- Execution counts and grouping by executor
- Balance history aggregation for earned points
- Payment aggregation for revenue

## 🐛 Troubleshooting

### "Chat not found" Error

**Cause**: Admin hasn't started the bot yet
**Solution**: Send `/start` command to the bot in Telegram

### Bot Not Responding

**Cause**: Backend container not running or bot not initialized
**Solution**:

```bash
ssh skyseo@5.35.80.127 "cd ~/skyseo_back && docker-compose restart"
ssh skyseo@5.35.80.127 "cd ~/skyseo_back && docker logs skyseo_backend --tail 50 | grep Telegram"
```

### Webhook Not Working

**Cause**: YooKassa webhook URL not configured
**Solution**: Configure webhook in YooKassa dashboard:

- URL: `https://skyseo.site/api/payments/webhook`
- Events: `payment.succeeded`

### Statistics Not Loading

**Cause**: Database connection issue or missing data
**Solution**: Check backend logs and verify database is accessible

## 📊 Example Statistics Output

### /stats

```
📊 Статистика SkySEO

👥 Пользователи:
├ Всего: 156
├ Активных (7 дней): 42
└ Выполняют задания: 28

📱 Версии приложения:
├ 1.0.0: 89 чел.
├ 0.9.5: 34 чел.
└ Не указана: 33 чел.

📋 Задания:
├ Всего создано: 487
├ Активных: 234
├ Выполнено: 1,523
├ Яндекс: 198
└ Google: 176

💰 Финансы:
├ Заработано баллов: 22,845
├ Платежей: 67
└ Выручка: 45,230.00 ₽

🕐 Обновлено: 25.04.2026, 16:30:15
```

### /daily

```
📅 Статистика за сегодня

👥 Пользователи:
├ Новых: 8
└ Активных: 15

📋 Задания:
├ Создано: 23
└ Выполнено: 67

💰 Финансы:
├ Платежей: 4
└ Выручка: 2,500.00 ₽

🕐 25.04.2026, 16:30:15
```

## 🔐 Security Notes

- Bot token is stored in `.env` file (never commit to git)
- Admin ID is hardcoded to prevent unauthorized access
- Webhook endpoint is public but validates YooKassa signatures
- All sensitive data is logged with partial masking (email domains only)

## 📝 Future Enhancements

Potential additional features:

- `/users` - List recent users
- `/tasks` - List recent tasks
- `/alerts` - Configure custom alerts
- `/export` - Export statistics to CSV
- Weekly/Monthly automated reports
- Low balance warnings for website owners
- Suspicious activity alerts
