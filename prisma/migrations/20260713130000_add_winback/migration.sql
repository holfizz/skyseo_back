-- Win-back: письмо при удалении + бонус +500 за возвращение (оба ровно один раз за всё время)

-- Новый тип операции в истории баланса
ALTER TYPE "BalanceHistoryType" ADD VALUE 'WINBACK_BONUS';

-- Флаги на пользователе (NULL = ещё не было)
ALTER TABLE "users" ADD COLUMN "winbackEmailSentAt" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "winbackBonusGrantedAt" TIMESTAMP(3);
