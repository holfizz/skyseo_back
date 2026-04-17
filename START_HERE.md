# 🚀 START HERE - Деплой за 10 минут

## Что нужно сделать

### 1️⃣ На сервере (5 минут)

```bash
# Подключиться
ssh skyseo@37.18.102.4

# Установить всё одной командой
curl -fsSL https://get.docker.com | sh && \
sudo apt install -y docker-compose nginx git gnupg && \
sudo usermod -aG docker $USER

# Перелогиниться
exit
ssh skyseo@37.18.102.4
```

### 2️⃣ SSH ключ для GitHub (2 минуты)

```bash
# Сгенерировать ключ
ssh-keygen -t ed25519 -C "skyseo@server" -f ~/.ssh/id_ed25519_github

# Показать ключ
cat ~/.ssh/id_ed25519_github.pub
```

**→ Скопируйте вывод**  
**→ Добавьте на https://github.com/settings/keys**

```bash
# Настроить SSH
cat > ~/.ssh/config << 'EOF'
Host github.com
    HostName github.com
    User git
    IdentityFile ~/.ssh/id_ed25519_github
    IdentitiesOnly yes
EOF
chmod 600 ~/.ssh/config

# Проверить
ssh -T git@github.com
```

### 3️⃣ Клонировать и настроить (2 минуты)

```bash
# Клонировать
cd ~
git clone git@github.com:YOUR_USERNAME/skyseo_back.git
cd skyseo_back

# Настроить .env
cp .env.production .env
nano .env
```

**Изменить в .env:**

- `POSTGRES_PASSWORD` - придумайте пароль
- `JWT_SECRET` - выполните: `openssl rand -base64 32`
- `SMTP_USER` и `SMTP_PASSWORD` - ваш email

### 4️⃣ Nginx (1 минута)

```bash
sudo cp nginx.conf /etc/nginx/sites-available/skyseo.site
sudo ln -s /etc/nginx/sites-available/skyseo.site /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl restart nginx
```

### 5️⃣ Запустить! (1 минута)

```bash
chmod +x deploy.sh scripts/*.sh
./scripts/setup-cron.sh
./deploy.sh
```

## ✅ Проверка

```bash
# Статус
docker-compose ps

# API
curl http://skyseo.site/v1/api/health

# Логи
docker-compose logs -f
```

## 🎉 Готово!

**API доступен:** `http://skyseo.site/v1/api/`

**Бэкапы:** Автоматически каждый день в 2:00 AM

**Обновление:** `./deploy.sh`

---

## 📚 Дальше

- [QUICK_START.md](QUICK_START.md) - подробная инструкция
- [COMMANDS_CHEATSHEET.md](COMMANDS_CHEATSHEET.md) - шпаргалка команд
- [ANSWERS.md](ANSWERS.md) - ответы на вопросы

## 🔑 Важно запомнить

**Пароль бэкапов:** `Holfizz1827.?`

**API URL:** `http://skyseo.site/v1/api/`

**Обновление:** `cd ~/skyseo_back && ./deploy.sh`

**Бэкап:** `docker-compose exec backup /backup.sh`

**Логи:** `docker-compose logs -f`

---

**Вопросы?** Читайте [ANSWERS.md](ANSWERS.md)
