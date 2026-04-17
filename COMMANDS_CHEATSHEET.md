# Commands Cheatsheet

## 🚀 Быстрый старт

```bash
# На сервере
ssh skyseo@37.18.102.4
cd ~/skyseo_back
./deploy.sh
```

## 📦 Docker

```bash
# Запустить
docker-compose up -d

# Остановить
docker-compose down

# Перезапустить
docker-compose restart

# Пересобрать
docker-compose up -d --build

# Статус
docker-compose ps

# Логи (все)
docker-compose logs -f

# Логи (backend)
docker-compose logs -f backend

# Логи (postgres)
docker-compose logs -f postgres

# Ресурсы
docker stats

# Удалить всё
docker-compose down -v
```

## 🗄️ База данных

```bash
# Подключиться к БД
docker-compose exec postgres psql -U skyseo -d skyseo

# Миграции
docker-compose exec backend npx prisma migrate deploy

# Prisma Studio
docker-compose exec backend npx prisma studio

# Создать бэкап
docker-compose exec backup /backup.sh

# Восстановить бэкап
docker-compose exec backup /restore.sh /backups/skyseo_backup_YYYYMMDD_HHMMSS.sql.gpg

# Список бэкапов
ls -lh backups/
```

## 🔄 Git

```bash
# Обновить код
git pull origin main

# Статус
git status

# Коммит
git add .
git commit -m "message"
git push origin main

# Проверка SSH
ssh -T git@github.com
```

## 🌐 Nginx

```bash
# Проверить конфиг
sudo nginx -t

# Перезапустить
sudo systemctl restart nginx

# Статус
sudo systemctl status nginx

# Логи ошибок
sudo tail -f /var/log/nginx/error.log

# Логи доступа
sudo tail -f /var/log/nginx/access.log
```

## 🔒 SSL (Certbot)

```bash
# Установить
sudo apt install certbot python3-certbot-nginx -y

# Получить сертификат
sudo certbot --nginx -d skyseo.site -d www.skyseo.site

# Обновить сертификат
sudo certbot renew

# Проверить автообновление
sudo certbot renew --dry-run
```

## 🔥 Firewall

```bash
# Статус
sudo ufw status

# Разрешить порты
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Включить
sudo ufw enable

# Отключить
sudo ufw disable
```

## 🔍 Мониторинг

```bash
# Проверка API
curl http://localhost:3000/v1/api/health
curl http://skyseo.site/v1/api/health

# Использование диска
df -h

# Использование памяти
free -h

# Процессы
top
htop

# Сетевые подключения
netstat -tulpn
ss -tulpn
```

## 📊 Логи

```bash
# Все логи приложения
docker-compose logs -f

# Последние 100 строк
docker-compose logs --tail=100

# Логи с временными метками
docker-compose logs -f -t

# Логи конкретного контейнера
docker-compose logs -f backend
docker-compose logs -f postgres

# Nginx логи
sudo tail -f /var/log/nginx/error.log
sudo tail -f /var/log/nginx/access.log

# Системные логи
sudo journalctl -u nginx -f
sudo journalctl -u docker -f
```

## 🔧 Troubleshooting

```bash
# Перезапустить всё
docker-compose restart

# Пересобрать с нуля
docker-compose down
docker-compose up -d --build --force-recreate

# Очистить неиспользуемые образы
docker system prune -a

# Проверить место на диске
df -h
du -sh ~/skyseo_back/*

# Проверить порты
sudo netstat -tulpn | grep :3000
sudo netstat -tulpn | grep :5432

# Проверить DNS
nslookup skyseo.site
dig skyseo.site

# Проверить подключение к БД
docker-compose exec postgres pg_isready -U skyseo
```

## 📥 Бэкапы

```bash
# Создать бэкап
docker-compose exec backup /backup.sh

# Список бэкапов
ls -lh backups/

# Скачать бэкап на локальный компьютер
scp skyseo@37.18.102.4:~/skyseo_back/backups/skyseo_backup_*.gpg .

# Расшифровать бэкап (пароль: Holfizz1827.?)
gpg --decrypt skyseo_backup_YYYYMMDD_HHMMSS.sql.gpg > backup.sql

# Восстановить бэкап
docker-compose exec backup /restore.sh /backups/skyseo_backup_YYYYMMDD_HHMMSS.sql.gpg

# Удалить старые бэкапы (оставить последние 10)
ls -t backups/*.gpg | tail -n +11 | xargs rm
```

## 🔄 Обновление

```bash
# Полное обновление
cd ~/skyseo_back
./deploy.sh

# Или вручную
git pull origin main
docker-compose down
docker-compose up -d --build
docker-compose exec backend npx prisma migrate deploy
```

## 🛠️ Разработка

```bash
# Локальный запуск
npm run dev

# Сборка
npm run build

# Миграции
npm run prisma:migrate

# Prisma Studio
npm run prisma:studio

# Seed данных
npm run prisma:seed
```

## 📝 Полезные алиасы

Добавьте в `~/.bashrc`:

```bash
alias dc='docker-compose'
alias dcl='docker-compose logs -f'
alias dcp='docker-compose ps'
alias dcr='docker-compose restart'
alias dcu='docker-compose up -d'
alias dcd='docker-compose down'

alias skyseo='cd ~/skyseo_back'
alias deploy='cd ~/skyseo_back && ./deploy.sh'
alias logs='cd ~/skyseo_back && docker-compose logs -f'
alias backup='cd ~/skyseo_back && docker-compose exec backup /backup.sh'
```

Применить:

```bash
source ~/.bashrc
```

Теперь можно использовать:

```bash
skyseo    # перейти в директорию
deploy    # деплой
logs      # смотреть логи
backup    # создать бэкап
```
