-- Прогрев Telegram: пул прокси, аккаунты, запуски прогрева, журнал действий.
-- Логика расписания и оценки — в src/tg-warmup/.

CREATE TYPE "TgAccountStatus" AS ENUM ('NEW', 'READY', 'WARMING', 'PAUSED', 'BANNED', 'ERROR');
CREATE TYPE "TgWarmupStatus"  AS ENUM ('SCHEDULED', 'RUNNING', 'DONE', 'FAILED', 'STOPPED');

-- Пул прокси. Только SOCKS4/SOCKS5: HTTP-прокси MTProto не поддерживает.
CREATE TABLE "tg_proxies" (
    "id"          TEXT NOT NULL,
    "host"        TEXT NOT NULL,
    "port"        INTEGER NOT NULL,
    "username"    TEXT,
    "password"    TEXT,
    "kind"        TEXT NOT NULL DEFAULT 'socks5',
    -- mobile | residential | datacenter. Ставится руками: по адресу не определить.
    "type"        TEXT,
    "geo"         TEXT,
    "note"        TEXT,
    "alive"       BOOLEAN NOT NULL DEFAULT true,
    "lastCheckAt" TIMESTAMP(3),
    "lastError"   TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tg_proxies_pkey" PRIMARY KEY ("id")
);
-- Логин входит в ключ намеренно: у мобильных прокси хост и порт общие на всех,
-- различает их именно логин.
CREATE UNIQUE INDEX "tg_proxies_host_port_username_key" ON "tg_proxies"("host", "port", "username");

CREATE TABLE "tg_accounts" (
    "id"             TEXT NOT NULL,
    "label"          TEXT,
    "phone"          TEXT,
    "tgUserId"       TEXT,
    "username"       TEXT,
    "firstName"      TEXT,
    "lastName"       TEXT,
    -- Строковая сессия, зашифрованная aes-256-gcm. В открытом виде не хранится:
    -- это полный доступ к аккаунту.
    "session"        TEXT NOT NULL,
    "apiId"          INTEGER NOT NULL,
    "apiHash"        TEXT NOT NULL,
    -- Фингерпринт уходит на сервер при каждом подключении, поэтому постоянный.
    "deviceModel"    TEXT NOT NULL,
    "systemVersion"  TEXT NOT NULL,
    "appVersion"     TEXT NOT NULL,
    "langCode"       TEXT NOT NULL,
    "systemLangCode" TEXT NOT NULL,
    "proxyId"        TEXT,
    "status"         "TgAccountStatus" NOT NULL DEFAULT 'NEW',
    "score"          DOUBLE PRECISION,
    "warmness"       DOUBLE PRECISION,
    "scoredAt"       TIMESTAMP(3),
    "probe"          JSONB,
    "advice"         JSONB,
    "registeredAt"   TIMESTAMP(3),
    "actionsTotal"   INTEGER NOT NULL DEFAULT 0,
    "warmupDaysDone" INTEGER NOT NULL DEFAULT 0,
    "floodWaits"     INTEGER NOT NULL DEFAULT 0,
    "peerFloods"     INTEGER NOT NULL DEFAULT 0,
    "reauths"        INTEGER NOT NULL DEFAULT 0,
    "lastCheckAt"    TIMESTAMP(3),
    "lastError"      TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,
    CONSTRAINT "tg_accounts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "tg_accounts_status_idx" ON "tg_accounts"("status");
-- SET NULL, а не CASCADE: удаление прокси не должно уносить аккаунты.
ALTER TABLE "tg_accounts" ADD CONSTRAINT "tg_accounts_proxyId_fkey"
    FOREIGN KEY ("proxyId") REFERENCES "tg_proxies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "tg_warmup_runs" (
    "id"         TEXT NOT NULL,
    "accountId"  TEXT NOT NULL,
    "days"       INTEGER NOT NULL,
    "dayIndex"   INTEGER NOT NULL DEFAULT 0,
    "status"     "TgWarmupStatus" NOT NULL DEFAULT 'SCHEDULED',
    "windowFrom" INTEGER NOT NULL DEFAULT 9,
    "windowTo"   INTEGER NOT NULL DEFAULT 23,
    "nextRunAt"  TIMESTAMP(3),
    "planDate"   TEXT,
    "plan"       JSONB,
    "doneToday"  INTEGER NOT NULL DEFAULT 0,
    "startedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "lastError"  TEXT,
    "lockedAt"   TIMESTAMP(3),
    CONSTRAINT "tg_warmup_runs_pkey" PRIMARY KEY ("id")
);
-- Индекс ровно под выборку планировщика: status + nextRunAt.
CREATE INDEX "tg_warmup_runs_status_nextRunAt_idx" ON "tg_warmup_runs"("status", "nextRunAt");
ALTER TABLE "tg_warmup_runs" ADD CONSTRAINT "tg_warmup_runs_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "tg_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "tg_warmup_actions" (
    "id"        TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "runId"     TEXT,
    "dayIndex"  INTEGER NOT NULL DEFAULT 0,
    "kind"      TEXT NOT NULL,
    "ok"        BOOLEAN NOT NULL DEFAULT true,
    "detail"    TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tg_warmup_actions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "tg_warmup_actions_accountId_createdAt_idx" ON "tg_warmup_actions"("accountId", "createdAt");
ALTER TABLE "tg_warmup_actions" ADD CONSTRAINT "tg_warmup_actions_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "tg_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tg_warmup_actions" ADD CONSTRAINT "tg_warmup_actions_runId_fkey"
    FOREIGN KEY ("runId") REFERENCES "tg_warmup_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
