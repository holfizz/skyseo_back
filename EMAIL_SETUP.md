# 📧 Настройка Email для SkySEO

## Вариант 1: SMTP через Beget (Рекомендуется)

### Преимущества:

- ✅ Бесплатно (входит в хостинг)
- ✅ Надежная доставка
- ✅ Не требует верификации домена
- ✅ До 30 писем в минуту

### Настройка:

1. **Создайте почтовый ящик на Beget:**
   - Зайдите в панель управления Beget
   - Раздел "Почта" → "Почтовые ящики"
   - Создайте ящик: `info@skyseo.site`
   - Запомните пароль

2. **Добавьте в `.env` файл:**

```env
# SMTP настройки Beget
SMTP_HOST="smtp.beget.com"
SMTP_PORT="465"
SMTP_SECURE="true"
SMTP_USER="info@skyseo.site"
SMTP_PASS="ваш_пароль_от_почты"
SMTP_FROM="SkySEO <info@skyseo.site>"
```

3. **Перезапустите сервер:**

```bash
# Локально
npm run dev

# В Docker
docker-compose restart backend
```

### Параметры Beget SMTP:

| Параметр         | Значение                     |
| ---------------- | ---------------------------- |
| **Сервер**       | smtp.beget.com               |
| **Порт SSL**     | 465 (рекомендуется)          |
| **Порт TLS**     | 587                          |
| **Порт без SSL** | 25 или 2525                  |
| **Логин**        | ваш email (info@skyseo.site) |
| **Пароль**       | пароль от почтового ящика    |

### Ограничения Beget:

- 📨 До 30 писем в минуту
- 📨 До 1500 писем в час
- 📨 До 300 получателей в одном письме
- 📨 Максимальный размер письма: 75 МБ

---

## Вариант 2: Resend API

### Преимущества:

- ✅ Простая интеграция
- ✅ Хорошая аналитика
- ❌ Требует верификации домена
- ❌ Платно после лимита

### Настройка:

1. **Зарегистрируйтесь на [resend.com](https://resend.com)**

2. **Получите API ключ:**
   - Dashboard → API Keys → Create API Key

3. **Верифицируйте домен:**
   - Dashboard → Domains → Add Domain
   - Добавьте `skyseo.site`
   - Добавьте DNS записи в панели Beget

4. **Добавьте в `.env`:**

```env
# Закомментируйте или удалите SMTP_HOST
# SMTP_HOST="smtp.beget.com"

# Добавьте Resend
RESEND_API_KEY="re_ваш_ключ"
EMAIL_FROM="SkySEO <info@skyseo.site>"
```

---

## Тестирование Email

После настройки протестируйте отправку:

```bash
# Локально
npm run test:emails

# В Docker
docker exec skyseo_backend npm run test:emails
```

Скрипт отправит 6 тестовых писем на `gorlach7v@gmail.com`:

1. Приветственное письмо
2. Подтверждение email
3. Низкий баланс
4. Успешный платеж
5. Восстановление пароля
6. Еженедельный отчет

---

## Проверка конфигурации

Сервис автоматически определяет какой метод использовать:

```typescript
// Приоритет:
1. Если установлен SMTP_HOST → используется SMTP
2. Если установлен RESEND_API_KEY → используется Resend
3. Если ничего не установлено → email отключен
```

Проверьте логи при запуске:

```
✅ [NotificationsService] SMTP initialized successfully
или
✅ [NotificationsService] Resend initialized successfully
```

---

## Требования к рассылкам (Beget)

⚠️ **Важно для соблюдения правил Beget:**

В каждом письме должна быть ссылка на отписку:

- Ссылка должна быть активной
- Отписка без дополнительной авторизации
- Не должна вести на форму email

Пример (уже добавлено в еженедельный отчет):

```html
<p style="font-size: 12px;">
	Вы получаете этот отчёт каждый понедельник.
	<a href="https://skyseo.site/settings"
		>Отписаться можно в настройках профиля</a
	>.
</p>
```

---

## Troubleshooting

### Письма не отправляются через SMTP

1. **Проверьте логин и пароль:**

   ```bash
   # Попробуйте войти в почту через веб-интерфейс Beget
   ```

2. **Проверьте порт:**

   ```env
   # Попробуйте другой порт
   SMTP_PORT="587"
   SMTP_SECURE="false"
   ```

3. **Проверьте firewall:**
   ```bash
   # Убедитесь что порт 465 или 587 открыт
   telnet smtp.beget.com 465
   ```

### Письма попадают в спам

1. Настройте SPF запись в DNS:

   ```
   v=spf1 include:_spf.beget.com ~all
   ```

2. Настройте DKIM (в панели Beget)

3. Настройте DMARC запись:
   ```
   v=DMARC1; p=none; rua=mailto:info@skyseo.site
   ```

---

## Мониторинг

Все отправки логируются:

```
[NotificationsService] Email sent via SMTP successfully, ID: <message-id>
[NotificationsService] Failed to send email: <error>
```

Для production рекомендуется настроить мониторинг логов.
