# Deployment Guide

## Подготовка сервера

### 1. Подключение к серверу

```bash
ssh skyseo@37.18.102.4
```

### 2. Установка зависимостей

```bash
# Обновление системы
sudo apt update && sudo apt upgrade -y

# Установка Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER

# Установка Docker Compose
sudo apt install docker-compose -y

# Установка Nginx
sudo apt install nginx -y

# Установка Git
sudo apt install git -y

# Установка GPG для шифрования бэкапов
sudo apt install gnupg -y
```

### 3. Настройка SSH ключей для GitHub

```bash
# Генерация SSH ключа
ssh-keygen -t ed25519 -C "skyseo@37.18.102.4" -f ~/.ssh/id_ed25519_github

# Запуск SSH агента
eval "$(ssh-agent -s)"
ssh-add ~/.ssh/id_ed25519_github

# Показать публичный ключ (добавить в GitHub)
cat ~/.ssh/id_ed25519_github.pub
```

**Скопируйте вывод и добавьте в GitHub:**

1. GitHub → Settings → SSH and GPG keys → New SSH key
2. Вставьте ключ и сохраните

### 4. Настройка SSH config

```bash
cat > ~/.ssh/config << 'EOF'
Host github.com
    HostName github.com
    User git
    IdentityFile ~/.ssh/id_ed25519_github
    IdentitiesOnly yes
EOF

chmod 600 ~/.ssh/config
```

### 5. Клонирование репозитория

```bash
cd ~
git clone git@github.com:YOUR_USERNAME/skyseo_back.git
cd skyseo_back
```

### 6. Настройка окружения

```bash
# Скопировать и отредактировать .env
cp .env.production .env
nano .env

# ВАЖНО: Измените следующие значения:
# - POSTGRES_PASSWORD (сильный пароль)
# - JWT_SECRET (длинная случайная строка)
# - SMTP_USER и SMTP_PASSWORD (ваши данные)
# - YOOKASSA_SHOP_ID и YOOKASSA_SECRET_KEY
```

### 7. Настройка Nginx

```bash
# Копировать конфиг
sudo cp nginx.conf /etc/nginx/sites-available/skyseo.site
sudo ln -s /etc/nginx/sites-available/skyseo.site /etc/nginx/sites-enabled/

# Удалить дефолтный конфиг
sudo rm /etc/nginx/sites-enabled/default

# Проверить конфиг
sudo nginx -t

# Перезапустить Nginx
sudo systemctl restart nginx
sudo systemctl enable nginx
```

### 8. Запуск приложения

```bash
# Сделать скрипты исполняемыми
chmod +x deploy.sh scripts/*.sh

# Первый деплой
./deploy.sh
```

## Управление

### Деплой обновлений

```bash
cd ~/skyseo_back
./deploy.sh
```

### Просмотр логов

```bash
# Все логи
docker-compose logs -f

# Только backend
docker-compose logs -f backend

# Только база данных
docker-compose logs -f postgres
```

### Остановка/запуск

```bash
# Остановить
docker-compose down

# Запустить
docker-compose up -d

# Перезапустить
docker-compose restart
```

## Бэкапы

### Создание бэкапа вручную

```bash
docker-compose exec backup /backup.sh
```

### Автоматические бэкапы

Бэкапы создаются автоматически каждый день в 2:00 AM.

### Восстановление из бэкапа

```bash
# Список бэкапов
ls -lh backups/

# Восстановить
docker-compose exec backup /restore.sh /backups/skyseo_backup_YYYYMMDD_HHMMSS.sql.gpg
```

### Расшифровка бэкапа локально

```bash
# Скачать бэкап
scp skyseo@37.18.102.4:~/skyseo_back/backups/skyseo_backup_*.gpg .

# Расшифровать (пароль: Holfizz1827.?)
gpg --decrypt skyseo_backup_*.gpg > backup.sql
```

## Мониторинг

### Проверка статуса

```bash
# Статус контейнеров
docker-compose ps

# Использование ресурсов
docker stats

# Проверка API
curl http://localhost:3000/v1/api/health
```

### Проверка через Nginx

```bash
curl http://skyseo.site/v1/api/health
```

## Troubleshooting

### Контейнер не запускается

```bash
# Проверить логи
docker-compose logs backend

# Пересобрать
docker-compose up -d --build --force-recreate
```

### База данных не подключается

```bash
# Проверить статус
docker-compose ps postgres

# Проверить логи
docker-compose logs postgres

# Перезапустить
docker-compose restart postgres
```

### Nginx ошибки

```bash
# Проверить конфиг
sudo nginx -t

# Проверить логи
sudo tail -f /var/log/nginx/error.log
```

## Безопасность

### Firewall

```bash
# Установить UFW
sudo apt install ufw -y

# Разрешить SSH, HTTP, HTTPS
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Включить
sudo ufw enable
```

### SSL (позже)

```bash
# Установить Certbot
sudo apt install certbot python3-certbot-nginx -y

# Получить сертификат
sudo certbot --nginx -d skyseo.site -d www.skyseo.site
```

## Обновление

### Обновление зависимостей

```bash
cd ~/skyseo_back
git pull
docker-compose down
docker-compose up -d --build
```

### Обновление Docker

```bash
sudo apt update
sudo apt upgrade docker-ce docker-ce-cli containerd.io
```
