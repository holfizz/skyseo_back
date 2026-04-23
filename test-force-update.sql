-- Тестовая запись для проверки системы обязательных обновлений
-- Вставляем версию 1.0.1 как обязательную для всех платформ

INSERT INTO app_versions (id, version, platform, "downloadUrl", sha512, "fileSize", "releaseNotes", mandatory, "isActive", "createdAt", "updatedAt")
VALUES 
  (gen_random_uuid(), '1.0.1', 'DARWIN_ARM64', 'https://example.com/SkySEO-1.0.1-mac-arm64.dmg', 'test_sha512_hash', 50000000, ARRAY['Критическое обновление безопасности', 'Исправлены ошибки автозапуска', 'Улучшена стабильность'], true, true, NOW(), NOW()),
  (gen_random_uuid(), '1.0.1', 'DARWIN_X64', 'https://example.com/SkySEO-1.0.1-mac-x64.dmg', 'test_sha512_hash', 50000000, ARRAY['Критическое обновление безопасности', 'Исправлены ошибки автозапуска', 'Улучшена стабильность'], true, true, NOW(), NOW()),
  (gen_random_uuid(), '1.0.1', 'WIN32_X64', 'https://example.com/SkySEO-1.0.1-win-x64.exe', 'test_sha512_hash', 50000000, ARRAY['Критическое обновление безопасности', 'Исправлены ошибки автозапуска', 'Улучшена стабильность'], true, true, NOW(), NOW()),
  (gen_random_uuid(), '1.0.1', 'WIN32_IA32', 'https://example.com/SkySEO-1.0.1-win-ia32.exe', 'test_sha512_hash', 50000000, ARRAY['Критическое обновление безопасности', 'Исправлены ошибки автозапуска', 'Улучшена стабильность'], true, true, NOW(), NOW());

-- Для тестирования необязательного обновления (закомментировано):
-- UPDATE app_versions SET mandatory = false WHERE version = '1.0.1';

-- Для отключения обязательного обновления:
-- UPDATE app_versions SET "isActive" = false WHERE version = '1.0.1';

-- Проверка:
SELECT version, platform, mandatory, "isActive", "releaseNotes" FROM app_versions ORDER BY "createdAt" DESC;
