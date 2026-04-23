#!/bin/bash

# Тестовый curl запрос для проверки вебхука YooKassa
# Замените PAYMENT_ID на реальный ID платежа из YooKassa

PAYMENT_ID="317c1378-000f-5001-9000-1e3f811f1fc3"  # Замените на реальный ID
SERVER_URL="https://skyseo.site/v1/api"  # Для продакшена
# SERVER_URL="http://localhost:4000/v1/api"  # Для локального тестирования

echo "Тестирование вебхука YooKassa..."
echo "URL: $SERVER_URL/payments/webhook"
echo "Payment ID: $PAYMENT_ID"
echo ""

curl -X POST "$SERVER_URL/payments/webhook" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "notification",
    "event": "payment.succeeded",
    "object": {
      "id": "'$PAYMENT_ID'",
      "status": "succeeded",
      "paid": true,
      "amount": {
        "value": "666.67",
        "currency": "RUB"
      },
      "authorization_details": {
        "rrn": "10000000000",
        "auth_code": "000000"
      },
      "created_at": "2026-04-23T10:00:00.000Z",
      "description": "Пополнение баланса SkySEO",
      "expires_at": "2026-04-23T11:00:00.000Z",
      "metadata": {},
      "payment_method": {
        "type": "bank_card",
        "id": "2982d1b8-000f-5000-8000-18db351245c7",
        "saved": false,
        "card": {
          "first6": "555555",
          "last4": "4444",
          "expiry_month": "07",
          "expiry_year": "2030",
          "card_type": "MasterCard",
          "issuer_country": "RU"
        },
        "title": "Bank card *4444"
      },
      "recipient": {
        "account_id": "100500",
        "gateway_id": "100700"
      },
      "refundable": true,
      "test": false
    }
  }' \
  -w "\n\nHTTP Status: %{http_code}\nResponse Time: %{time_total}s\n"

echo ""
echo "Проверьте логи сервера для подробной информации о обработке вебхука."