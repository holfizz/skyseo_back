#!/bin/bash

# Скрипт для запуска Xray прокси для Telegram
# Использование: ./start-proxy.sh

XRAY_CONFIG="xray-config.json"
XRAY_BINARY="xray"

# Проверяем наличие конфига
if [ ! -f "$XRAY_CONFIG" ]; then
    echo "❌ Конфиг файл $XRAY_CONFIG не найден"
    exit 1
fi

# Проверяем установлен ли xray
if ! command -v $XRAY_BINARY &> /dev/null; then
    echo "❌ Xray не установлен. Установите его:"
    echo "   wget https://github.com/XTLS/Xray-core/releases/latest/download/Xray-linux-64.zip"
    echo "   unzip Xray-linux-64.zip"
    echo "   sudo mv xray /usr/local/bin/"
    echo "   sudo chmod +x /usr/local/bin/xray"
    exit 1
fi

echo "🚀 Запуск Xray прокси для Telegram..."
echo "📍 SOCKS5 прокси будет доступен на 127.0.0.1:1080"
echo "🔄 Для остановки нажмите Ctrl+C"

# Запускаем xray
$XRAY_BINARY run -config $XRAY_CONFIG