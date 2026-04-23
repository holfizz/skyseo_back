#!/bin/bash

# Быстрый тест вебхука с фиктивными данными
# Этот запрос покажет работает ли endpoint, но не найдет платеж в базе

echo "Быстрый тест вебхука YooKassa..."

curl -X POST "https://skyseo.site/v1/api/payments/webhook" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "notification",
    "event": "payment.succeeded",
    "object": {
      "id": "test-payment-id-12345",
      "status": "succeeded",
      "paid": true,
      "amount": {
        "value": "100.00",
        "currency": "RUB"
      },
      "created_at": "2026-04-23T10:00:00.000Z",
      "description": "Test payment"
    }
  }' \
  -w "\n\nHTTP Status: %{http_code}\n"

echo ""
echo "Ожидаемый результат: HTTP 200 и в логах должно появиться:"
echo "- [Payments] Webhook received - FULL BODY:"
echo "- [Payments] Payment not found in database"