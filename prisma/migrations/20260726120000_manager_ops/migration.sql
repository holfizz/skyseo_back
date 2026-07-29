-- Кабинет менеджера: заметки по клиенту + отметка, кто вручную провёл платёж

-- Кто вручную выбил чек (email менеджера/админа); null у обычных онлайн-оплат
ALTER TABLE "payments" ADD COLUMN "issuedBy" TEXT;

-- Внутренние заметки менеджера по клиенту (клиент не видит)
CREATE TABLE "client_notes" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "authorEmail" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_notes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "client_notes_clientId_createdAt_idx" ON "client_notes"("clientId", "createdAt");

ALTER TABLE "client_notes" ADD CONSTRAINT "client_notes_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
