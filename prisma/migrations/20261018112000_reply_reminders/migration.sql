CREATE TABLE "tg_reply_reminders" (
    "recipientId" TEXT NOT NULL,
    "anchorTgId" INTEGER NOT NULL,
    "anchorAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "lastSentAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tg_reply_reminders_pkey" PRIMARY KEY ("recipientId"),
    CONSTRAINT "tg_reply_reminders_attempts_check" CHECK ("attempts" BETWEEN 0 AND 2),
    CONSTRAINT "tg_reply_reminders_recipientId_fkey" FOREIGN KEY ("recipientId")
        REFERENCES "tg_recipients"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "tg_reply_reminders_nextAt_idx" ON "tg_reply_reminders"("nextAt");

-- No historical backfill: deployment must not notify about months-old replies.
