-- Мягкий таргет пина на конкретный ПК с фолбэком в общий стакан
ALTER TABLE "pinned_tasks" ADD COLUMN "targetExecutorId" TEXT;
ALTER TABLE "pinned_tasks" ADD COLUMN "targetUntilAt" TIMESTAMP(3);
