# Deployment Checklist

## ✅ Что уже готово

- [x] Docker Compose конфигурация
- [x] Dockerfile для бэкенда
- [x] Nginx конфигурация
- [x] Скрипты бэкапов с шифрованием
- [x] Скрипт деплоя
- [x] API префикс `/v1/api/`
- [x] CORS для `skyseo.site`
- [x] .env.production шаблон
- [x] .gitignore обновлён
- [x] Документация

## 📋 Что нужно сделать

### 1. На сервере (ssh skyseo@37.18.102.4)

#### Установка зависимостей

```bash
sudo apt update && sudo apt upgrade -y
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER
sudo apt install docker-compose nginx git gnupg -y
```

#### SSH ключ для GitHub

```bash
ssh-keygen -t ed25519 -C "skyseo@server" -f ~/.ssh/id_ed25519_github
cat ~/.ssh/id_ed25519_github.pub
```

**→ Добавить на https://github.com/settings/keys**

#### SSH config

```bash
cat > ~/.ssh/config << 'EOF'
Host github.com
    HostName github.com
    User git
    IdentityFile ~/.ssh/id_ed25519_github
    IdentitiesOnly yes
EOF
chmod 600 ~/.ssh/config
ssh -T git@github.com
```

#### Клонирование

```bash
cd ~
git clone git@github.com:YOUR_USERNAME/skyseo_back.git
cd skyseo_back
```

#### Настройка .env

```bash
cp .env.production .env
nano .env
```

**Изменить:**

- POSTGRES_PASSWORD
- JWT_SECRET (сгенерировать: `openssl rand -base64 32`)
- SMTP_USER, SMTP_PASSWORD
- YOOKASSA_SHOP_ID, YOOKASSA_SECRET_KEY

#### Nginx

```bash
sudo cp nginx.conf /etc/nginx/sites-available/skyseo.site
sudo ln -s /etc/nginx/sites-available/skyseo.site /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx
```

#### Запуск

```bash
mkdir -p backups logs
chmod +x deploy.sh scripts/*.sh
./scripts/setup-cron.sh
./deploy.sh
```

### 2. DNS настройка

В панели управления доменом:

```
A    @    37.18.102.4
A    www  37.18.102.4
```

### 3. Проверка

```bash
# Статус
docker-compose ps

# Логи
docker-compose logs -f backend

# API
curl http://localhost:3000/v1/api/health
curl http://skyseo.site/v1/api/health
```

### 4. SSL (после DNS)

```bash
sudo apt install certbot python3-certbot-nginx -y
sudo certbot --nginx -d skyseo.site -d www.skyseo.site
```

### 5. Firewall

```bash
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

### 6. Обновить приложение

В `skyseo_app` изменить API URL на:

```
http://skyseo.site/v1/api/
```

После SSL:

```
https://skyseo.site/v1/api/
```

## 🔑 SSH ключи которые нужно добавить

### 1. GitHub Deploy Key (для сервера)

**Генерация на сервере:**

```bash
ssh-keygen -t ed25519 -C "skyseo@server" -f ~/.ssh/id_ed25519_github
cat ~/.ssh/id_ed25519_github.pub
```

**Куда добавить:**
https://github.com/settings/keys → New SSH key

### 2. Проверка подключения

```bash
ssh -T git@github.com
# Должно вывести: Hi USERNAME! You've successfully authenticated...
```

## 📦 Бэкапы

### Автоматические

- Время: 2:00 AM ежедневно
- Пароль: `Holfizz1827.?`
- Хранение: 30 последних
- Путь: `~/skyseo_back/backups/`

### Проверка

```bash
# Создать вручную
docker-compose exec backup /backup.sh

# Список
ls -lh backups/

# Скачать
scp skyseo@37.18.102.4:~/skyseo_back/backups/skyseo_backup_*.gpg .

# Расшифровать
gpg --decrypt skyseo_backup_*.gpg > backup.sql
```

## 🚀 Деплой обновлений

```bash
cd ~/skyseo_back
./deploy.sh
```

## 📊 Мониторинг

```bash
# Статус контейнеров
docker-compose ps

# Логи
docker-compose logs -f

# Ресурсы
docker stats

# Проверка API
curl http://skyseo.site/v1/api/health
```

## ⚠️ Важные заметки

1. **Python automation НЕ нужна на сервере** - она работает локально в приложении
2. **Бэкапы зашифрованы** - пароль `Holfizz1827.?`
3. **API префикс** - все эндпоинты теперь `/v1/api/...`
4. **CORS** - настроен для `skyseo.site`
5. **SSL** - настроить после DNS
6. **Firewall** - обязательно настроить

## 🆘 Troubleshooting

### Контейнер не запускается

```bash
docker-compose logs backend
docker-compose up -d --build --force-recreate
```

### База не подключается

```bash
docker-compose logs postgres
docker-compose restart postgres
```

### Nginx ошибки

```bash
sudo nginx -t
sudo tail -f /var/log/nginx/error.log
```

## 📞 Контакты

Если что-то не работает, проверьте:

1. Логи: `docker-compose logs -f`
2. Статус: `docker-compose ps`
3. Конфиг: `.env` файл
4. Nginx: `sudo nginx -t`
5. DNS: `nslookup skyseo.site`
