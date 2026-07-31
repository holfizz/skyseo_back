-- Принудительная очередь заданий (админ ставит задание в начало раздачи)
CREATE TABLE "pinned_tasks" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 1,
    "force" BOOLEAN NOT NULL DEFAULT false,
    "consumedByExecutorId" TEXT,
    "consumedAt" TIMESTAMP(3),
    "createdByEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pinned_tasks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "pinned_tasks_consumedAt_position_idx" ON "pinned_tasks"("consumedAt", "position");

ALTER TABLE "pinned_tasks" ADD CONSTRAINT "pinned_tasks_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
