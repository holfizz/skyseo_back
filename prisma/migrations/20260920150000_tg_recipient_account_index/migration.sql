-- Индекс под расчёт дневной нормы аккаунта: он каждую минуту спрашивает,
-- сколько сообщений ушло с аккаунта за сутки и за последние двое. Все три
-- запроса фильтруют tg_recipients по accountId, а индекса по нему не было —
-- каждый читал таблицу целиком.
CREATE INDEX IF NOT EXISTS "tg_recipients_accountId_sentAt_idx" ON "tg_recipients"("accountId", "sentAt");

-- Второй индекс: один из трёх запросов смотрит на дату ВТОРОГО касания,
-- и общего префикса accountId для него мало.
CREATE INDEX IF NOT EXISTS "tg_recipients_accountId_secondSentAt_idx" ON "tg_recipients"("accountId", "secondSentAt");
