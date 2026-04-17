# Ответы на вопросы

## 1. Python automation - нужно ли в git?

**ДА**, но только для бэкенда (если планируете использовать на сервере).

**НЕТ** для десктопного приложения - там Python запускается локально.

### Структура:

- `skyseo_app/python_automation/` - **НЕ** коммитить в git (уже в .gitignore)
- `skyseo_back/python_automation/` - **КОММИТИТЬ** если нужно на сервере

## 2. Python запускается внутри приложения?

**ДА!** Python запускается локально на компьютере пользователя.

Смотрите `skyseo_app/src/main/services/BrowserAutomation.ts`:

```typescript
// Запускает локальный Python скрипт
const pythonProcess = spawn(pythonPath, [scriptPath, ...args])
```

### Как это работает:

1. Пользователь устанавливает приложение
2. Приложение содержит Python скрипты в `resources/python_automation/`
3. При запуске автоматизации приложение запускает локальный Python
4. Python открывает браузер на компьютере пользователя
5. Выполняет действия и возвращает результат

### На сервере:

- Сервер (API) **НЕ** запускает браузер
- Сервер только хранит данные и управляет пользователями
- Вся автоматизация происходит на компьютере пользователя

## 3. Что настроено в деплое?

✅ **Docker** - контейнеризация приложения
✅ **PostgreSQL** - база данных в контейнере
✅ **Автоматические бэкапы** - каждый день в 2:00 AM
✅ **Шифрование бэкапов** - GPG с паролем `Holfizz1827.?`
✅ **Nginx** - reverse proxy для API
✅ **CORS** - настроен для `skyseo.site`
✅ **API префикс** - `/v1/api/`
✅ **SSH ключи** - для приватных репозиториев GitHub
✅ **Автоматический деплой** - скрипт `deploy.sh`

## 4. Структура URL

### До изменений:

```
http://skyseo.site/auth/login
http://skyseo.site/users
```

### После изменений:

```
http://skyseo.site/v1/api/auth/login
http://skyseo.site/v1/api/users
```

## 5. Что нужно сделать?

### На вашем компьютере:

1. Ничего! Просто следуйте инструкции в `QUICK_START.md`

### На сервере:

1. Установить Docker, Nginx, Git
2. Настроить SSH ключи для GitHub
3. Клонировать репозиторий
4. Настроить `.env`
5. Запустить `./deploy.sh`

### SSH ключи для GitHub:

**Вам нужно будет добавить этот ключ в GitHub:**

После выполнения на сервере:

```bash
ssh-keygen -t ed25519 -C "skyseo@server" -f ~/.ssh/id_ed25519_github
cat ~/.ssh/id_ed25519_github.pub
```

Скопируйте вывод и добавьте на:
https://github.com/settings/keys → New SSH key

## 6. Бэкапы

### Автоматические:

- Каждый день в 2:00 AM
- Шифруются паролем `Holfizz1827.?`
- Хранятся 30 последних бэкапов
- Находятся в `~/skyseo_back/backups/`

### Ручные:

```bash
docker-compose exec backup /backup.sh
```

### Восстановление:

```bash
docker-compose exec backup /restore.sh /backups/skyseo_backup_YYYYMMDD_HHMMSS.sql.gpg
```

### Скачать бэкап:

```bash
scp skyseo@37.18.102.4:~/skyseo_back/backups/skyseo_backup_*.gpg .
```

### Расшифровать локально:

```bash
gpg --decrypt skyseo_backup_*.gpg > backup.sql
# Пароль: Holfizz1827.?
```

## 7. Безопасность

✅ Пароли в `.env` (не в git)
✅ Бэкапы зашифрованы
✅ JWT токены
✅ CORS настроен
✅ Firewall (нужно настроить)
✅ SSL (настроить после DNS)

## 8. Мониторинг

### Проверка статуса:

```bash
docker-compose ps
docker-compose logs -f
curl http://localhost:3000/v1/api/health
```

### Использование ресурсов:

```bash
docker stats
```

## 9. Обновление

```bash
cd ~/skyseo_back
./deploy.sh
```

Скрипт автоматически:

1. Подтянет код из git
2. Остановит контейнеры
3. Пересоберёт образы
4. Запустит контейнеры
5. Применит миграции БД

## 10. Что дальше?

1. Следуйте `QUICK_START.md`
2. Настройте DNS для домена
3. Настройте SSL (certbot)
4. Настройте firewall (ufw)
5. Проверьте работу API
6. Обновите URL в десктопном приложении на `http://skyseo.site/v1/api/`
