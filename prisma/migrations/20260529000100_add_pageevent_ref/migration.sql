-- Реферальный код пригласившего в событиях страницы (для IP-атрибуции реферала)
ALTER TABLE "page_events" ADD COLUMN IF NOT EXISTS "ref" TEXT;

-- Индекс под запрос атрибуции: последний реф-клик с этого IP за окно времени
CREATE INDEX IF NOT EXISTS "page_events_ip_createdAt_idx" ON "page_events"("ip", "createdAt");
