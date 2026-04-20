#!/bin/bash

# Скрипт для быстрой пересборки и перезапуска бэкенда

echo "🔨 Пересборка бэкенда с обновлением зависимостей..."

# Останавливаем контейнер
docker-compose stop backend

# Пересобираем образ (с --no-cache для чистой сборки)
docker-compose build --no-cache backend

# Запускаем контейнер
docker-compose up -d backend

# Ждем 5 секунд для запуска
echo ""
echo "⏳ Ожидание запуска..."
sleep 5

# Показываем логи
echo ""
echo "📋 Логи бэкенда:"
docker-compose logs -f backend
