ALTER TABLE "tasks"
	ADD COLUMN IF NOT EXISTS "assignedExecutorId" TEXT;

CREATE INDEX IF NOT EXISTS "tasks_assignedExecutorId_idx"
	ON "tasks"("assignedExecutorId");

UPDATE "tasks"
SET
	"status" = 'PENDING',
	"assignedAt" = NULL,
	"assignedExecutorId" = NULL
WHERE
	"status" = 'ASSIGNED'
	AND "assignedExecutorId" IS NULL;
