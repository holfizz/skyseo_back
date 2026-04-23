# Тестирование вебхука YooKassa

## 1. Проверка логов

После создания платежа в приложении, проверьте логи сервера:

```bash
# На сервере
docker logs skyseo_backend --tail 50 -f

# Или локально
npm run start:dev
```

Ищите строки:

- `[Payments] Creating payment`
- `[Payments] YooKassa payment created`
- `[Payments] Webhook received - FULL BODY:`

## 2. Тестирование вебхука вручную

1. Найдите в логах `externalId` созданного платежа (например: `317c1378-000f-5001-9000-1e3f811f1fc3`)

2. Отредактируйте файл `test-webhook.sh`:

   ```bash
   PAYMENT_ID="ВАШ_EXTERNAL_ID_ИЗ_ЛОГОВ"
   ```

3. Запустите тест:
   ```bash
   chmod +x test-webhook.sh
   ./test-webhook.sh
   ```

## 3. Проверка кнопки "Проверить платеж"

В приложении:

1. Создайте платеж
2. Нажмите "Проверить платеж"
3. Проверьте логи - должны появиться строки:
   - `[Payments] Getting payment status`
   - `[Payments] Checking status in YooKassa`
   - `[Payments] YooKassa status response`

## 4. Что проверить в логах

### При создании платежа:

```
[Payments] Creating payment { userId: 'xxx', points: 5000, amount: 666.67 }
[Payments] Payment created in DB {paymentId: 'xxx', status: 'PENDING'}
[Payments] Creating YooKassa payment {paymentId: 'xxx', amount: 666.67, emailDomain: 'gmail.com'}
[Payments] YooKassa payment created {paymentId: 'xxx', externalId: 'xxx', hasConfirmationUrl: true}
```

### При получении вебхука:

```
[Payments] Webhook received - FULL BODY: { "type": "notification", "event": "payment.succeeded", ... }
[Payments] Webhook parsed { event: 'payment.succeeded', paymentId: 'xxx', status: 'succeeded', ... }
[Payments] Processing payment.succeeded for externalId: xxx
[Payments] Payment found in database { paymentId: 'xxx', currentStatus: 'PENDING', ... }
[Payments] Processing payment { paymentId: 'xxx', userId: 'xxx...', points: 5000 }
[Payments] Payment status updated to SUCCEEDED
[Payments] Balance updated { paymentId: 'xxx', pointsAdded: 5000 }
[Payments] Payment processing completed successfully { paymentId: 'xxx' }
```

### При проверке статуса:

```
[Payments] Getting payment status { paymentId: 'xxx', userId: 'xxx...' }
[Payments] Payment found in database { paymentId: 'xxx', status: 'PENDING', externalId: 'xxx' }
[Payments] Checking status in YooKassa { externalId: 'xxx' }
[Payments] YooKassa status response { externalId: 'xxx', status: 'succeeded', paid: true, amount: '666.67' }
[Payments] Payment succeeded, updating status
[Payments] Balance updated for payment { paymentId: 'xxx' }
```

## 5. Возможные проблемы

1. **Вебхук не приходит** - проверьте настройки в личном кабинете YooKassa
2. **Ошибка 404 на вебхук** - проверьте URL: `https://skyseo.site/v1/api/payments/webhook`
3. **Payment not found** - проверьте что `externalId` в вебхуке совпадает с ID в базе данных
4. **Кнопка не работает** - проверьте что токен авторизации валидный

## 6. URL для настройки в YooKassa

Webhook URL: `https://skyseo.site/v1/api/payments/webhook`
События: `payment.succeeded`, `payment.canceled`
