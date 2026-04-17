# SkySEO Backend - Production Deployment

## 🎯 Что настроено

✅ **Docker + Docker Compose** - контейнеризация  
✅ **PostgreSQL** - база данных  
✅ **Автоматические бэкапы** - ежедневно в 2:00 AM  
✅ **Шифрование бэкапов** - GPG с паролем  
✅ **Nginx** - reverse proxy  
✅ **API префикс** - `/v1/api/`  
✅ **CORS** - настроен для `skyseo.site`  
✅ **Автодеплой** - скрипт `deploy.sh`

## 📚 Документация

1. **[QUICK_START.md](QUICK_START.md)** - быстрый старт (начните отсюда!)
2. **[DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md)** - чеклист деплоя
3. **[COMMANDS_CHEATSHEET.md](COMMANDS_CHEATSHEET.md)** - шпаргалка команд
4. **[DEPLOYMENT.md](DEPLOYMENT.md)** - полная документация
5. **[ANSWERS.md](ANSWERS.md)** - ответы на вопросы

## ⚡ Быстрый старт

### 1. На сервере

```bash
ssh skyseo@37.18.102.4

# Установка
curl -fsSL https://get.docker.com | sh
sudo apt install docker-compose nginx git gnupg -y

# SSH ключ для GitHub
ssh-keygen -t ed25519 -C "skyseo@server" -f ~/.ssh/id_ed25519_github
cat ~/.ssh/id_ed25519_github.pub
# → Добавить на https://github.com/settings/keys

# Клонирование
git clone git@github.com:YOUR_USERNAME/skyseo_back.git
cd skyseo_back

# Настройка
cp .env.production .env
nano .env  # Изменить пароли и ключи

# Nginx
sudo cp nginx.conf /etc/nginx/sites-available/skyseo.site
sudo ln -s /etc/nginx/sites-available/skyseo.site /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl restart nginx

# Запуск
chmod +x deploy.sh scripts/*.sh
./deploy.sh
```

### 2. Проверка

```bash
docker-compose ps
curl http://skyseo.site/v1/api/health
```

## 🔑 SSH ключи для GitHub

**На сервере выполните:**

```bash
ssh-keygen -t ed25519 -C "skyseo@server" -f ~/.ssh/id_ed25519_github
cat ~/.ssh/id_ed25519_github.pub
```

**Скопируйте вывод и добавьте:**

1. Зайдите на https://github.com/settings/keys
2. Нажмите "New SSH key"
3. Вставьте ключ и сохраните

**Настройте SSH config:**

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

**Проверьте:**

```bash
ssh -T git@github.com
# Должно вывести: Hi USERNAME! You've successfully authenticated...
```

## 🗄️ Бэкапы

### Автоматические

- **Время:** 2:00 AM ежедневно
- **Пароль:** `Holfizz1827.?`
- **Хранение:** 30 последних
- **Путь:** `~/skyseo_back/backups/`

### Команды

```bash
# Создать вручную
docker-compose exec backup /backup.sh

# Список
ls -lh backups/

# Скачать
scp skyseo@37.18.102.4:~/skyseo_back/backups/skyseo_backup_*.gpg .

# Расшифровать (пароль: Holfizz1827.?)
gpg --decrypt skyseo_backup_*.gpg > backup.sql

# Восстановить
docker-compose exec backup /restore.sh /backups/skyseo_backup_*.gpg
```

## 🔄 Обновление

```bash
cd ~/skyseo_back
./deploy.sh
```

## 📊 Мониторинг

```bash
# Статус
docker-compose ps

# Логи
docker-compose logs -f

# API
curl http://skyseo.site/v1/api/health

# Ресурсы
docker stats
```

## 🌐 API Endpoints

**Base URL:** `http://skyseo.site/v1/api/`

После SSL: `https://skyseo.site/v1/api/`

### Примеры:

- `POST /v1/api/auth/register`
- `POST /v1/api/auth/login`
- `GET /v1/api/users/profile`
- `GET /v1/api/executions`

## ⚙️ Конфигурация

### .env файл

```bash
# Обязательно изменить:
POSTGRES_PASSWORD=...      # Сильный пароль
JWT_SECRET=...             # openssl rand -base64 32
SMTP_USER=...              # Email
SMTP_PASSWORD=...          # App password
YOOKASSA_SHOP_ID=...       # YooKassa
YOOKASSA_SECRET_KEY=...    # YooKassa
```

### Nginx

- Конфиг: `/etc/nginx/sites-available/skyseo.site`
- Префикс: `/v1/api/` → `http://localhost:3000/`
- CORS: `skyseo.site`

### Docker

- Backend: порт 3000
- PostgreSQL: порт 5432
- Volumes: `postgres_data`, `backups`, `logs`

## 🔒 Безопасность

### Firewall

```bash
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

### SSL (после настройки DNS)

```bash
sudo apt install certbot python3-certbot-nginx -y
sudo certbot --nginx -d skyseo.site -d www.skyseo.site
```

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

### API не отвечает

```bash
# Проверить статус
docker-compose ps

# Проверить логи
docker-compose logs -f backend

# Проверить порт
curl http://localhost:3000/v1/api/health

# Проверить через Nginx
curl http://skyseo.site/v1/api/health
```

## 📞 Важные заметки

1. **Python automation НЕ нужна на сервере** - работает локально в приложении
2. **API префикс** - все эндпоинты `/v1/api/...`
3. **Бэкапы зашифрованы** - пароль `Holfizz1827.?`
4. **DNS** - настроить A-запись на `37.18.102.4`
5. **SSL** - настроить после DNS
6. **Обновление** - просто `./deploy.sh`

## 📁 Структура файлов

```
skyseo_back/
├── docker-compose.yml      # Docker конфигурация
├── Dockerfile              # Backend образ
├── nginx.conf              # Nginx конфиг
├── deploy.sh               # Скрипт деплоя
├── .env.production         # Шаблон переменных
├── scripts/
│   ├── backup.sh           # Бэкап с шифрованием
│   ├── restore.sh          # Восстановление
│   └── setup-cron.sh       # Настройка автобэкапов
├── backups/                # Зашифрованные бэкапы
├── logs/                   # Логи приложения
└── docs/
    ├── QUICK_START.md
    ├── DEPLOYMENT_CHECKLIST.md
    ├── COMMANDS_CHEATSHEET.md
    ├── DEPLOYMENT.md
    └── ANSWERS.md
```

## 🚀 Следующие шаги

1. ✅ Следуйте [QUICK_START.md](QUICK_START.md)
2. ✅ Настройте DNS
3. ✅ Настройте SSL
4. ✅ Настройте firewall
5. ✅ Обновите URL в приложении

## 💡 Полезные команды

```bash
# Деплой
./deploy.sh

# Логи
docker-compose logs -f

# Бэкап
docker-compose exec backup /backup.sh

# Статус
docker-compose ps

# Перезапуск
docker-compose restart
```

---

**Готово к деплою!** 🎉

Начните с [QUICK_START.md](QUICK_START.md)
