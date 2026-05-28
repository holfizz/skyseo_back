-- Индексы под горячие запросы getAvailableTasks (вызывается каждой нодой каждые ~30 сек).
-- Без них запросы по executorId/websiteId + status + completedAt идут full scan'ом.
-- IF NOT EXISTS: если на проде индексы уже созданы вручную через CREATE INDEX CONCURRENTLY
-- (см. README/инструкцию деплоя), эта миграция станет no-op без блокировки записи.
CREATE INDEX IF NOT EXISTS "executions_executorId_status_completedAt_idx" ON "executions"("executorId", "status", "completedAt");
CREATE INDEX IF NOT EXISTS "executions_websiteId_status_completedAt_idx" ON "executions"("websiteId", "status", "completedAt");
CREATE INDEX IF NOT EXISTS "executions_taskId_executorId_status_idx" ON "executions"("taskId", "executorId", "status");
