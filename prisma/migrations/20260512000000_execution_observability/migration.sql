-- Execution observability and honest completion metadata
CREATE TYPE "ExecutionCompletionKind" AS ENUM ('NORMAL', 'DEGRADED', 'SKIPPED');

ALTER TABLE "executions"
	ADD COLUMN IF NOT EXISTS "targetVisited" BOOLEAN NOT NULL DEFAULT false,
	ADD COLUMN IF NOT EXISTS "directNavigationUsed" BOOLEAN NOT NULL DEFAULT false,
	ADD COLUMN IF NOT EXISTS "completionKind" "ExecutionCompletionKind";

CREATE TABLE IF NOT EXISTS "execution_events" (
	"id" TEXT NOT NULL,
	"executionId" TEXT,
	"taskId" TEXT,
	"executorId" TEXT,
	"engine" TEXT,
	"type" TEXT NOT NULL,
	"stage" TEXT NOT NULL,
	"details" JSONB,
	"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT "execution_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "execution_events_executionId_createdAt_idx"
	ON "execution_events"("executionId", "createdAt");

CREATE INDEX IF NOT EXISTS "execution_events_taskId_createdAt_idx"
	ON "execution_events"("taskId", "createdAt");

CREATE INDEX IF NOT EXISTS "execution_events_executorId_createdAt_idx"
	ON "execution_events"("executorId", "createdAt");

ALTER TABLE "execution_events"
	ADD CONSTRAINT "execution_events_executionId_fkey"
	FOREIGN KEY ("executionId") REFERENCES "executions"("id")
	ON DELETE CASCADE ON UPDATE CASCADE;
