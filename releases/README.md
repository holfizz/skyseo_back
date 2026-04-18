# Структура файлов обновлений SkySEO

## Форматы файлов по платформам

### macOS

- **Формат**: `.dmg` (Disk Image)
- **Архитектуры**:
  - `arm64` (Apple Silicon M1/M2+)
  - `x64` (Intel)
- **Примеры файлов**:
  - `SkySEO-1.2.0-arm64.dmg`
  - `SkySEO-1.2.0-x64.dmg`

### Windows

- **Формат**: `.exe` (NSIS installer) или `.msi` (Windows Installer)
- **Рекомендуется**: `.exe` (лучше поддерживается electron-updater)
- **Архитектуры**:
  - `x64` (64-bit)
  - `ia32` (32-bit)
- **Примеры файлов**:
  - `SkySEO-1.2.0-x64.exe`
  - `SkySEO-1.2.0-ia32.exe`

## Структура папки releases

```
skyseo_back/releases/
├── SkySEO-1.2.0-arm64.dmg      # macOS Apple Silicon
├── SkySEO-1.2.0-x64.dmg        # macOS Intel
├── SkySEO-1.2.0-x64.exe        # Windows 64-bit
├── SkySEO-1.2.0-ia32.exe       # Windows 32-bit
├── latest-mac.yml              # Метаданные для macOS
├── latest.yml                  # Метаданные для Windows
└── README.md                   # Эта документация
```

## Как загружать файлы

### 1. Соберите приложение

```bash
cd skyseo_app

# Для macOS
npm run package:mac:arm64
npm run package:mac:x64

# Для Windows (требует Docker или Windows)
npm run package:win
```

### 2. Скопируйте файлы на сервер

```bash
# Скопируйте .dmg/.exe файлы в папку releases
scp skyseo_app/release/*.dmg user@server:/path/to/skyseo_back/releases/
scp skyseo_app/release/*.exe user@server:/path/to/skyseo_back/releases/
```

### 3. Сгенерируйте хеши файлов

```bash
cd skyseo_back/releases

# Для macOS файлов
shasum -a 512 SkySEO-1.2.0-arm64.dmg
shasum -a 512 SkySEO-1.2.0-x64.dmg

# Для Windows файлов
shasum -a 512 SkySEO-1.2.0-x64.exe
shasum -a 512 SkySEO-1.2.0-ia32.exe
```

### 4. Обновите метаданные

#### latest-mac.yml

```yaml
version: 1.2.0
files:
  - url: SkySEO-1.2.0-arm64.dmg
    sha512: [SHA512_HASH_ARM64]
    size: [FILE_SIZE_BYTES]
  - url: SkySEO-1.2.0-x64.dmg
    sha512: [SHA512_HASH_X64]
    size: [FILE_SIZE_BYTES]
path: SkySEO-1.2.0-arm64.dmg
sha512: [SHA512_HASH_ARM64]
releaseDate: '2026-04-18T12:00:00.000Z'
```

#### latest.yml (Windows)

```yaml
version: 1.2.0
files:
  - url: SkySEO-1.2.0-x64.exe
    sha512: [SHA512_HASH_X64]
    size: [FILE_SIZE_BYTES]
  - url: SkySEO-1.2.0-ia32.exe
    sha512: [SHA512_HASH_IA32]
    size: [FILE_SIZE_BYTES]
path: SkySEO-1.2.0-x64.exe
sha512: [SHA512_HASH_X64]
releaseDate: '2026-04-18T12:00:00.000Z'
```

## API Endpoints

### Проверка обновлений

- `GET /v1/api/updates/check/{platform}/{currentVersion}`
- Платформы: `darwin-arm64`, `darwin-x64`, `win32-x64`, `win32-ia32`

### Загрузка файлов

- `GET /v1/api/updates/download/{filename}`
- Поддерживаемые форматы: `.dmg`, `.exe`, `.msi`, `.yml`

### Метаданные

- `GET /v1/api/updates/latest-mac.yml` - для macOS
- `GET /v1/api/updates/latest.yml` - для Windows
- `GET /v1/api/updates/latest` - JSON с информацией о версии

## Автоматизация

### Скрипт для обновления версии

```bash
#!/bin/bash
VERSION="1.2.0"

# 1. Обновить версию в package.json
cd skyseo_app
npm version $VERSION --no-git-tag-version

# 2. Собрать приложения
npm run build:prod
npm run package:mac:arm64
npm run package:mac:x64

# 3. Скопировать файлы
cp release/*.dmg ../skyseo_back/releases/

# 4. Сгенерировать хеши и обновить yml файлы
cd ../skyseo_back/releases
# ... генерация хешей и обновление yml
```

## Проверка работы

### Тестирование API

```bash
# Проверить последнюю версию
curl https://skyseo.site/v1/api/updates/latest

# Проверить обновления для macOS
curl https://skyseo.site/v1/api/updates/check/darwin-arm64/1.1.0

# Проверить метаданные
curl https://skyseo.site/v1/api/updates/latest-mac.yml
```

### Тестирование в приложении

1. Запустите приложение версии 1.1.0
2. Нажмите "Проверить обновления" в разделе "О программе"
3. Должно появиться модальное окно с предложением обновиться до 1.2.0

## Безопасность

- Все файлы проверяются по расширению
- SHA512 хеши обеспечивают целостность
- Только авторизованные форматы файлов
- Volume mapping защищает от записи в контейнер
