ALTER TABLE "tg_recipients"
    ADD COLUMN "replyHandledThroughTgId" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "replyHandledAt" TIMESTAMP(3),
    ADD COLUMN "conversationMark" TEXT,
    ADD COLUMN "conversationMarkedAt" TIMESTAMP(3),
    ADD COLUMN "peerDeleted" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "tg_recipients"
    ADD CONSTRAINT "tg_recipients_reply_handled_check" CHECK ("replyHandledThroughTgId" >= 0),
    ADD CONSTRAINT "tg_recipients_conversation_mark_check"
        CHECK ("conversationMark" IS NULL OR "conversationMark" IN ('BLOCKED', 'HISTORY_DELETED'));
