-- CRM (Telegram Mini App). Аддитивная миграция: новые таблицы, старое не трогаем.

-- CreateEnum
CREATE TYPE "CrmRole" AS ENUM ('ADMIN', 'EMPLOYEE');
CREATE TYPE "CrmClientStatus" AS ENUM ('LEAD', 'NEGOTIATION', 'ACTIVE', 'PAUSED', 'CHURNED');
CREATE TYPE "CrmTaskStatus" AS ENUM ('DRAFT', 'TODO', 'IN_PROGRESS', 'DONE');

-- CreateTable crm_users
CREATE TABLE "crm_users" (
    "id" TEXT NOT NULL,
    "telegramId" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "username" TEXT,
    "photoUrl" TEXT,
    "role" "CrmRole" NOT NULL DEFAULT 'EMPLOYEE',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3),

    CONSTRAINT "crm_users_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "crm_users_telegramId_key" ON "crm_users"("telegramId");

-- CreateTable crm_clients
CREATE TABLE "crm_clients" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "company" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "telegram" TEXT,
    "website" TEXT,
    "status" "CrmClientStatus" NOT NULL DEFAULT 'LEAD',
    "notes" TEXT,
    "userId" TEXT,
    "assigneeId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_clients_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "crm_clients_status_idx" ON "crm_clients"("status");
CREATE INDEX "crm_clients_assigneeId_idx" ON "crm_clients"("assigneeId");
CREATE INDEX "crm_clients_userId_idx" ON "crm_clients"("userId");

-- CreateTable crm_tasks
CREATE TABLE "crm_tasks" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "CrmTaskStatus" NOT NULL DEFAULT 'TODO',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "dueAt" TIMESTAMP(3),
    "position" INTEGER NOT NULL DEFAULT 0,
    "clientId" TEXT,
    "assigneeId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "crm_tasks_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "crm_tasks_status_position_idx" ON "crm_tasks"("status", "position");
CREATE INDEX "crm_tasks_assigneeId_idx" ON "crm_tasks"("assigneeId");
CREATE INDEX "crm_tasks_clientId_idx" ON "crm_tasks"("clientId");
CREATE INDEX "crm_tasks_dueAt_idx" ON "crm_tasks"("dueAt");

-- CreateTable crm_reminders
CREATE TABLE "crm_reminders" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "remindAt" TIMESTAMP(3) NOT NULL,
    "offsetLabel" TEXT,
    "targetId" TEXT,
    "sent" BOOLEAN NOT NULL DEFAULT false,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_reminders_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "crm_reminders_sent_remindAt_idx" ON "crm_reminders"("sent", "remindAt");
CREATE INDEX "crm_reminders_taskId_idx" ON "crm_reminders"("taskId");

-- CreateTable crm_activity
CREATE TABLE "crm_activity" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "summary" TEXT,
    "suspicious" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_activity_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "crm_activity_createdAt_idx" ON "crm_activity"("createdAt");
CREATE INDEX "crm_activity_actorId_createdAt_idx" ON "crm_activity"("actorId", "createdAt");

-- AddForeignKey
ALTER TABLE "crm_clients" ADD CONSTRAINT "crm_clients_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "crm_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_clients" ADD CONSTRAINT "crm_clients_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "crm_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_tasks" ADD CONSTRAINT "crm_tasks_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "crm_clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_tasks" ADD CONSTRAINT "crm_tasks_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "crm_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_tasks" ADD CONSTRAINT "crm_tasks_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "crm_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_reminders" ADD CONSTRAINT "crm_reminders_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "crm_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_reminders" ADD CONSTRAINT "crm_reminders_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "crm_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_activity" ADD CONSTRAINT "crm_activity_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "crm_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
