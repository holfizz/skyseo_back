# Система обязательных обновлений (Force Update)

## Описание

Система позволяет блокировать работу устаревших версий приложения, заставляя пользователей обновиться до последней версии.

## Как это работает

1. **При запуске приложения** (`App.tsx`):
   - Приложение отправляет запрос к API: `GET /app-version/check?version=1.0.0&platform=darwin-arm64`
   - Сервер проверяет, есть ли более новая версия с флагом `mandatory: true`
   - Если есть обязательное обновление - показывается блокирующий экран `ForceUpdateScreen`

2. **Блокирующий экран**:
   - Занимает весь экран
   - Показывает информацию о новой версии
   - Показывает список изменений (release notes)
   - Предоставляет кнопку "Скачать обновление" (открывает URL в браузере)
   - Предоставляет кнопку "Выйти из приложения"
   - **НЕ позволяет** использовать приложение до обновления

## Использование

### 1. Добавление обязательного обновления

```sql
-- Вставить новую версию с mandatory = true
INSERT INTO app_versions (
  id, version, platform, "downloadUrl", sha512, "fileSize",
  "releaseNotes", mandatory, "isActive", "createdAt", "updatedAt"
)
VALUES (
  gen_random_uuid(),
  '1.0.1',                                    -- Новая версия
  'DARWIN_ARM64',                             -- Платформа
  'https://example.com/SkySEO-1.0.1.dmg',    -- URL для скачивания
  'sha512_hash_here',                         -- SHA512 хеш файла
  50000000,                                   -- Размер файла в байтах
  ARRAY[
    'Критическое обновление безопасности',
    'Исправлены ошибки',
    'Новые функции'
  ],                                          -- Список изменений
  true,                                       -- mandatory = true (обязательное!)
  true,                                       -- isActive = true
  NOW(),
  NOW()
);
```

### 2. Тестирование

Используйте готовый SQL скрипт:

```bash
# Подключитесь к базе данных
psql -U postgres -d skyseo_dev

# Выполните скрипт
\i test-force-update.sql
```

### 3. Отключение обязательного обновления

```sql
-- Сделать обновление необязательным
UPDATE app_versions
SET mandatory = false
WHERE version = '1.0.1';

-- Или полностью отключить версию
UPDATE app_versions
SET "isActive" = false
WHERE version = '1.0.1';
```

### 4. Проверка текущих версий

```sql
SELECT
  version,
  platform,
  mandatory,
  "isActive",
  "releaseNotes",
  "createdAt"
FROM app_versions
ORDER BY "createdAt" DESC;
```

## API Endpoint

### GET /app-version/check

**Query параметры:**

- `version` (required) - текущая версия приложения (например: "1.0.0")
- `platform` (required) - платформа (например: "darwin-arm64", "win32-x64")

**Поддерживаемые платформы:**

- `darwin-arm64` - macOS Apple Silicon (M1/M2/M3)
- `darwin-x64` - macOS Intel
- `win32-x64` - Windows 64-bit
- `win32-ia32` - Windows 32-bit

**Ответ:**

```json
{
	"updateRequired": true, // Обязательное обновление (блокирует приложение)
	"updateAvailable": true, // Доступно обновление
	"currentVersion": "1.0.0",
	"latestVersion": "1.0.1",
	"downloadUrl": "https://example.com/SkySEO-1.0.1.dmg",
	"releaseNotes": ["Критическое обновление безопасности", "Исправлены ошибки"],
	"mandatory": true
}
```

## Frontend компоненты

### ForceUpdateScreen.tsx

Полноэкранный блокирующий компонент, который:

- Показывается когда `updateRequired: true`
- Блокирует доступ ко всему приложению
- Показывает информацию о новой версии
- Предоставляет кнопки "Скачать" и "Выйти"

### App.tsx

При запуске проверяет версию:

```typescript
useEffect(() => {
	checkForMandatoryUpdate()
}, [])

const checkForMandatoryUpdate = async () => {
	const version = await window.electron.app.getVersion()
	const platform = await window.electron.app.getPlatform()

	const response = await fetch(
		`${API_URL}/app-version/check?version=${version}&platform=${platform}`,
	)

	const data = await response.json()

	if (data.updateRequired) {
		setForceUpdate(data)
	}
}
```

## Сценарии использования

### 1. Критическое обновление безопасности

```sql
-- Все пользователи ДОЛЖНЫ обновиться
INSERT INTO app_versions (...) VALUES (..., true, true, ...);
```

### 2. Важное обновление (рекомендуемое, но не обязательное)

```sql
-- Пользователи увидят уведомление, но смогут продолжить работу
INSERT INTO app_versions (...) VALUES (..., false, true, ...);
```

### 3. Постепенный rollout

```sql
-- Сначала выпускаем как необязательное
INSERT INTO app_versions (...) VALUES (..., false, true, ...);

-- Через неделю делаем обязательным
UPDATE app_versions
SET mandatory = true
WHERE version = '1.0.1';
```

## Логирование

Backend логирует все проверки версий:

```
[AppVersion] Checking version { currentVersion: '1.0.0', platform: 'darwin-arm64' }
[AppVersion] Version check result {
  currentVersion: '1.0.0',
  latestVersion: '1.0.1',
  isOutdated: true,
  isMandatory: true
}
```

## Безопасность

- ✅ Проверка версии происходит при каждом запуске приложения
- ✅ Нельзя обойти блокирующий экран (занимает весь экран, блокирует навигацию)
- ✅ Версии сравниваются корректно (1.0.0 < 1.0.1 < 1.1.0 < 2.0.0)
- ✅ Поддержка разных платформ (можно сделать обязательным только для Windows, например)

## Troubleshooting

### Приложение не показывает экран обновления

1. Проверьте, что версия в базе данных выше текущей:

   ```sql
   SELECT version, mandatory, "isActive" FROM app_versions WHERE platform = 'DARWIN_ARM64';
   ```

2. Проверьте логи backend:

   ```
   [AppVersion] Checking version ...
   ```

3. Проверьте версию приложения:
   ```typescript
   const version = await window.electron.app.getVersion()
   console.log('Current version:', version)
   ```

### Как убрать блокирующий экран для тестирования

```sql
-- Временно отключить все обязательные обновления
UPDATE app_versions SET mandatory = false;

-- Или отключить конкретную версию
UPDATE app_versions SET "isActive" = false WHERE version = '1.0.1';
```

## Миграция на production

1. Создайте релиз с новой версией
2. Загрузите файлы на CDN/сервер
3. Добавьте запись в `app_versions` с правильным `downloadUrl`
4. Установите `mandatory = true` если обновление критическое
5. Мониторьте логи для отслеживания обновлений пользователей
