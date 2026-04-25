#!/bin/bash

# Test Registration Notification
# This script simulates a user registration to test Telegram notifications

echo "🧪 Testing Registration Notification..."
echo ""

# Test registration endpoint
echo "📤 Sending registration request to: https://skyseo.site/api/auth/register"
echo ""

# Generate random email for testing
RANDOM_EMAIL="test$(date +%s)@gmail.com"
echo "📧 Test email: $RANDOM_EMAIL"
echo ""

curl -X POST https://skyseo.site/api/auth/register \
  -H "Content-Type: application/json" \
  -H "X-Forwarded-For: 95.165.123.45" \
  -d "{
    \"email\": \"$RANDOM_EMAIL\",
    \"password\": \"testpassword123\",
    \"referralSource\": \"Тестирование уведомлений\",
    \"city\": \"Москва\",
    \"appVersion\": \"1.0.0\"
  }"

echo ""
echo ""
echo "✅ Registration request sent!"
echo ""
echo "📊 Check the results:"
echo "1. Check backend logs: ssh skyseo@5.35.80.127 'cd ~/skyseo_back && docker logs skyseo_backend --tail 50 | grep Registration'"
echo "2. Check Telegram for registration notification"
echo "3. Check database: SELECT email, \"referralSource\", city, \"appVersion\", \"createdAt\" FROM users WHERE email = '$RANDOM_EMAIL';"
echo "4. Test /stats command in Telegram to see updated statistics"
echo ""
echo "🔍 Expected Telegram notification format:"
echo "🆕 Новая регистрация"
echo ""
echo "📧 Email: $RANDOM_EMAIL"
echo "🌍 Город: Москва"
echo "📍 Источник: Тестирование уведомлений"
echo "🌐 IP: 95.165.123.45"
echo "💰 Баланс: 1000 баллов"
echo "🕐 Время: [current time]"