#!/bin/bash

# Скрипт для установки Xray прокси на сервере (Ubuntu/Debian)
# Запускать от root или с sudo

echo "🚀 Установка Xray прокси для Telegram на сервере..."

# Проверяем что мы на Linux
if [[ "$OSTYPE" != "linux-gnu"* ]]; then
    echo "❌ Этот скрипт предназначен для Linux серверов"
    exit 1
fi

# Определяем архитектуру
ARCH=$(uname -m)
case $ARCH in
    x86_64)
        XRAY_ARCH="linux-64"
        ;;
    aarch64|arm64)
        XRAY_ARCH="linux-arm64-v8a"
        ;;
    *)
        echo "❌ Неподдерживаемая архитектура: $ARCH"
        exit 1
        ;;
esac

echo "📋 Архитектура: $ARCH -> $XRAY_ARCH"

# Создаем временную директорию
TEMP_DIR=$(mktemp -d)
cd "$TEMP_DIR"

echo "📥 Скачиваем Xray..."
wget -q "https://github.com/XTLS/Xray-core/releases/latest/download/Xray-${XRAY_ARCH}.zip"

if [ $? -ne 0 ]; then
    echo "❌ Ошибка скачивания Xray"
    exit 1
fi

echo "📦 Распаковываем..."
unzip -q "Xray-${XRAY_ARCH}.zip"

echo "📁 Устанавливаем в систему..."
mv xray /usr/local/bin/
chmod +x /usr/local/bin/xray

# Проверяем установку
if xray version >/dev/null 2>&1; then
    echo "✅ Xray установлен успешно"
    xray version
else
    echo "❌ Ошибка установки Xray"
    exit 1
fi

# Копируем конфиг в рабочую директорию
WORK_DIR="/root/skyseo_back"
if [ ! -d "$WORK_DIR" ]; then
    echo "❌ Директория $WORK_DIR не найдена"
    echo "   Убедитесь что бэкенд развернут в $WORK_DIR"
    exit 1
fi

echo "📋 Копируем конфигурацию..."
cp "$WORK_DIR/xray-config.json" /etc/xray-telegram.json

# Создаем systemd сервис
echo "🔧 Настраиваем systemd сервис..."
cat > /etc/systemd/system/xray-telegram.service << EOF
[Unit]
Description=Xray Proxy for Telegram
After=network.target
Wants=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$WORK_DIR
ExecStart=/usr/local/bin/xray run -config /etc/xray-telegram.json
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

# Безопасность
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$WORK_DIR

[Install]
WantedBy=multi-user.target
EOF

# Перезагружаем systemd
systemctl daemon-reload

# Включаем автозапуск
systemctl enable xray-telegram

# Запускаем сервис
systemctl start xray-telegram

# Проверяем статус
sleep 2
if systemctl is-active --quiet xray-telegram; then
    echo "✅ Xray прокси запущен успешно"
    echo "📍 SOCKS5 прокси доступен на 127.0.0.1:1080"
    
    # Проверяем что порт слушается
    if netstat -tlnp | grep -q ":1080 "; then
        echo "✅ Порт 1080 слушается"
    else
        echo "⚠️ Порт 1080 не слушается, проверьте логи"
    fi
    
    echo ""
    echo "🔧 Теперь обновите .env файл:"
    echo "   TELEGRAM_PROXY_URL=\"socks5://127.0.0.1:1080\""
    echo ""
    echo "📊 Проверить статус: systemctl status xray-telegram"
    echo "📋 Посмотреть логи: journalctl -u xray-telegram -f"
    
else
    echo "❌ Ошибка запуска Xray прокси"
    echo "📋 Проверьте логи: journalctl -u xray-telegram -f"
    exit 1
fi

# Очищаем временные файлы
cd /
rm -rf "$TEMP_DIR"

echo "🎉 Установка завершена!"