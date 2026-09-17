-- Автоснятие спам-лимита: через сутки после PEER_FLOOD планировщик сам пишет
-- @SpamBot, обжалует и присылает итог. Момент следующей попытки храним здесь.
ALTER TABLE "tg_accounts" ADD COLUMN IF NOT EXISTS "spamRetryAt" TIMESTAMP(3);
