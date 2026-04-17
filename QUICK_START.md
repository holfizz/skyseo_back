# Quick Start - Деплой на сервер

## 1. На вашем компьютере

### Генерация SSH ключа для сервера

```bash
ssh-keygen -t ed25519 -C "deploy@skyseo" -f ~/.ssh/skyseo_deploy
```

**Скопируйте публичный ключ:**

```bash
cat ~/.ssh/skyseo_deploy.pub
```

## 2. На сервере (ssh skyseo@37.18.102.4)

### Установка всего необходимого

```bash
# Обновление системы
sudo apt update && sudo apt upgrade -y

# Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER
sudo apt install docker-compose -y

# Nginx
sudo apt install nginx -y

# Git и GPG
sudo apt install git gnupg -y

# Перелогиниться для применения группы docker
exit
```

### Подключиться снова и настроить SSH для GitHub

```bash
ssh skyseo@37.18.102.4

# Генерация ключа для GitHub
ssh-keygen -t ed25519 -C "skyseo@server" -f ~/.ssh/id_ed25519_github

# Показать публичный ключ
cat ~/.ssh/id_ed25519_github.pub
```

**❗ ВАЖНО: Скопируйте этот ключ и добавьте в GitHub:**

- Зайдите на https://github.com/settings/keys
- Нажмите "New SSH key"
- Вставьте ключ и сохраните

### Настройка SSH config

```bash
cat > ~/.ssh/config << 'EOF'
Host github.com
    HostName github.com
    User git
    IdentityFile ~/.ssh/id_ed25519_github
    IdentitiesOnly yes
EOF

chmod 600 ~/.ssh/config

# Проверка подключения к GitHub
ssh -T git@github.com
```

### Клонирование репозитория

```bash
cd ~
git clone git@github.com:YOUR_USERNAME/skyseo_back.git
cd skyseo_back
```

### Настройка .env

```bash
cp .env.production .env
nano .env
```

**Измените в .env:**

- `POSTGRES_PASSWORD` - придумайте сильный пароль
- `JWT_SECRET` - длинная случайная строка (можно сгенерировать: `openssl rand -base64 32`)
- `SMTP_USER` и `SMTP_PASSWORD` - ваши email данные
- `YOOKASSA_SHOP_ID` и `YOOKASSA_SECRET_KEY` - данные YooKassa

### Настройка Nginx

```bash
sudo cp nginx.conf /etc/nginx/sites-available/skyseo.site
sudo ln -s /etc/nginx/sites-available/skyseo.site /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx
sudo systemctl enable nginx
```

### Создание директорий

```bash
mkdir -p backups logs
chmod +x deploy.sh scripts/*.sh
```

### Настройка автоматических бэкапов

```bash
chmod +x scripts/setup-cron.sh
./scripts/setup-cron.sh
```

### Запуск приложения

```bash
./deploy.sh
```

## 3. Проверка

### Проверить что все работает

```bash
# Статус контейнеров
docker-compose ps

# Логи
docker-compose logs -f backend

# API через localhost
curl http://localhost:3000/v1/api/health

# API через Nginx
curl http://skyseo.site/v1/api/health
```

## 4. Настройка DNS

В панели управления доменом `skyseo.site` добавьте A-запись:

```
A    @    37.18.102.4
A    www  37.18.102.4
```

## 5. Обновление кода

```bash
cd ~/skyseo_back
./deploy.sh
```

## Полезные команды

```bash
# Просмотр логов
docker-compose logs -f

# Перезапуск
docker-compose restart

# Остановка
docker-compose down

# Создать бэкап вручную
docker-compose exec backup /backup.sh

# Список бэкапов
ls -lh backups/
```

## Что дальше?

1. ✅ Настроить DNS для домена
2. ✅ Проверить работу API
3. 🔒 Настроить SSL (после настройки DNS):
   ```bash
   sudo apt install certbot python3-certbot-nginx -y
   sudo certbot --nginx -d skyseo.site -d www.skyseo.site
   ```
4. 🔥 Настроить firewall:
   ```bash
   sudo ufw allow 22/tcp
   sudo ufw allow 80/tcp
   sudo ufw allow 443/tcp
   sudo ufw enable
   ```
