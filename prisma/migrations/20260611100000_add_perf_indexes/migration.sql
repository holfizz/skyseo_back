-- Task: compound index for eligibleTaskWhere (status + isActive + keywordStatus + createdAt)
CREATE INDEX IF NOT EXISTS "tasks_websiteId_status_isActive_keywordStatus_createdAt_idx"
  ON "tasks" ("websiteId", "status", "isActive", "keywordStatus", "createdAt");

-- Execution: index for foundCounts groupBy (websiteId + foundInTop + completedAt)
CREATE INDEX IF NOT EXISTS "executions_websiteId_foundInTop_completedAt_idx"
  ON "executions" ("websiteId", "foundInTop", "completedAt");

-- BalanceHistory: index for getPaidPriorityOwners (type filter + userId groupBy)
CREATE INDEX IF NOT EXISTS "balance_history_type_userId_idx"
  ON "balance_history" ("type", "userId");
