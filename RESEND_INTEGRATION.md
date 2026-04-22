# Resend Email Integration & Password Reset

## Изменения

### 1. Интеграция Resend для отправки email

**Установлен пакет:**

```bash
npm install resend
```

**Обновлен NotificationsService:**

- Заменен nodemailer на Resend
- Добавлен метод `sendPasswordResetEmail()` для восстановления пароля
- Все email отправляются с адреса `info@skyseo.site`
- Добавлено безопасное логирование (только домены email, без полных адресов)

**Отправляемые письма:**

1. Приветственное письмо при регистрации (1000 баллов бонус)
2. Уведомление о низком балансе
3. Подтверждение успешного платежа
4. Восстановление пароля (новое)

### 2. Функционал восстановления пароля

**База данных:**

- Добавлена модель `PasswordResetToken` в Prisma schema
- Миграция: `20260422080446_add_password_reset_tokens`
- Токены действительны 1 час
- Токены одноразовые (флаг `used`)

**Backend API:**

- `POST /auth/forgot-password` - запрос на восстановление пароля
- `POST /auth/reset-password` - установка нового пароля по токену

**DTO:**

- `ForgotPasswordDto` - валидация email
- `ResetPasswordDto` - валидация токена и нового пароля (минимум 6 символов)

**AuthService методы:**

- `forgotPassword(email)` - генерирует токен и отправляет email
- `resetPassword(token, password)` - проверяет токен и обновляет пароль

### 3. Frontend страницы

**Созданы страницы:**

1. `/forgot-password` - форма запроса восстановления пароля
2. `/reset-password?token=xxx` - форма установки нового пароля

**Особенности:**

- Использован Suspense для useSearchParams (Next.js требование)
- Автоматическое перенаправление на /login после успешного сброса
- Валидация: пароли должны совпадать и быть минимум 6 символов
- Красивый UI с логотипом SkySEO

### 4. Desktop приложение

**LoginPage:**

- Добавлена кнопка "забыли пароль?"
- Открывает браузер на странице https://skyseo.site/forgot-password
- Использует `window.electron.shell.openExternal()`

**ApiService:**

- Добавлены методы `forgotPassword()` и `resetPassword()`
- Готовы к использованию, если понадобится в будущем

### 5. Конфигурация

**Переменные окружения (.env):**

```env
RESEND_API_KEY="re_NhjAjCwp_JnBYzJE3ahn36U6rLLGibwQt"
EMAIL_FROM="SkySEO <info@skyseo.site>"
```

**Удалены старые SMTP переменные:**

- SMTP_HOST
- SMTP_PORT
- SMTP_USER
- SMTP_PASSWORD

## Безопасность

**Логирование:**

- НЕ логируются: полные email, API ключи, токены, пароли
- Логируются: домены email, частичные ID (первые 8 символов), статусы

**Защита от перебора:**

- Одинаковый ответ независимо от существования email
- Токены одноразовые
- Токены истекают через 1 час
- Токены хранятся в БД с привязкой к пользователю

## Тестирование

**Для тестирования восстановления пароля:**

1. Перейти на https://skyseo.site/forgot-password
2. Ввести email зарегистрированного пользователя
3. Проверить email (info@skyseo.site должен быть настроен в Resend)
4. Перейти по ссылке из письма
5. Ввести новый пароль
6. Войти с новым паролем

**Проверка отправки email:**

- Регистрация нового пользователя → приветственное письмо
- Успешный платеж → письмо с подтверждением
- Восстановление пароля → письмо со ссылкой

## Следующие шаги

1. Настроить домен info@skyseo.site в Resend
2. Добавить DNS записи для домена (SPF, DKIM)
3. Протестировать отправку всех типов писем
4. Проверить, что письма не попадают в спам
5. Добавить красивые HTML шаблоны для писем (опционально)

## Файлы изменены

**Backend:**

- `src/notifications/notifications.service.ts` - Resend интеграция
- `src/auth/auth.service.ts` - методы восстановления пароля
- `src/auth/auth.controller.ts` - эндпоинты восстановления пароля
- `src/auth/auth.module.ts` - добавлены зависимости
- `src/auth/dto/forgot-password.dto.ts` - новый DTO
- `src/auth/dto/reset-password.dto.ts` - новый DTO
- `src/auth/dto/index.ts` - экспорт новых DTO
- `prisma/schema.prisma` - модель PasswordResetToken
- `.env` - Resend конфигурация
- `.env.example` - обновлен пример

**Frontend:**

- `app/forgot-password/page.tsx` - страница запроса восстановления
- `app/reset-password/page.tsx` - страница установки нового пароля

**Desktop App:**

- `src/renderer/pages/LoginPage.tsx` - кнопка "забыли пароль?"
- `src/main/services/ApiService.ts` - методы для восстановления пароля
- `src/renderer/types/electron.d.ts` - типы для shell.openExternal
