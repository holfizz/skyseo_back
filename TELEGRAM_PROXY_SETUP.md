# Настройка Telegram прокси для обхода блокировок

## Быстрая установка на сервере

### 1. Установка Xray

```bash
# Скачиваем последнюю версию Xray
wget https://github.com/XTLS/Xray-core/releases/latest/download/Xray-linux-64.zip

# Распаковываем
unzip Xray-linux-64.zip

# Устанавливаем в систему
sudo mv xray /usr/local/bin/
sudo chmod +x /usr/local/bin/xray

# Проверяем установку
xray version
```

### 2. Настройка systemd сервиса

```bash
# Копируем сервис в systemd
sudo cp xray-telegram.service /etc/systemd/system/

# Перезагружаем systemd
sudo systemctl daemon-reload

# Включаем автозапуск
sudo systemctl enable xray-telegram

# Запускаем сервис
sudo systemctl start xray-telegram

# Проверяем статус
sudo systemctl status xray-telegram
```

### 3. Проверка работы прокси

```bash
# Проверяем что прокси слушает на порту 1080
netstat -tlnp | grep 1080

# Тестируем прокси (если установлен curl с поддержкой SOCKS)
curl --socks5 127.0.0.1:1080 https://api.telegram.org/bot<YOUR_TOKEN>/getMe
```

### 4. Настройка переменных окружения

В файле `.env` должны быть:

```env
TELEGRAM_BOT_TOKEN="ваш_токен_бота"
TELEGRAM_ADMIN_ID="ваш_telegram_id"
TELEGRAM_PROXY_URL="socks5://127.0.0.1:1080"
```

### 5. Альтернативные настройки

Если основной прокси не работает, можно попробовать:

```env
# Отключить прокси (прямое подключение)
TELEGRAM_PROXY_URL="disabled"

# Использовать HTTP прокси
TELEGRAM_PROXY_URL="http://127.0.0.1:8080"

# Использовать другой SOCKS прокси
TELEGRAM_PROXY_URL="socks5://127.0.0.1:9050"
```

## Логи и отладка

```bash
# Смотрим логи Xray
sudo journalctl -u xray-telegram -f

# Смотрим логи приложения
pm2 logs skyseo-backend

# Проверяем подключение к Telegram API
curl -v --socks5 127.0.0.1:1080 https://api.telegram.org/bot<TOKEN>/getMe
```

## Устранение проблем

### Проблема: "Connection timeout"

- Проверьте что Xray запущен: `sudo systemctl status xray-telegram`
- Проверьте конфигурацию прокси в `xray-config.json`
- Убедитесь что порт 1080 не занят другим процессом

### Проблема: "SOCKS connection failed"

- Проверьте настройки прокси-сервера
- Попробуйте другой прокси или отключите прокси (`TELEGRAM_PROXY_URL="disabled"`)

### Проблема: "Bot token invalid"

- Проверьте правильность токена бота
- Убедитесь что бот не заблокирован

## Мониторинг

Приложение автоматически:

- Пытается переподключиться при сбоях сети
- Переключается на прямое подключение если прокси не работает
- Логирует все попытки подключения
- Отключает уведомления при критических ошибках

Telegram уведомления будут работать если:

1. ✅ Токен бота корректный
2. ✅ Admin ID указан правильно
3. ✅ Есть сетевое подключение (прямое или через прокси)
4. ✅ Бот не заблокирован Telegram

Если что-то не работает - проверьте логи приложения, там будут подробности.
