-- Темп прогрева. Значение по умолчанию совпадает с прежним поведением,
-- поэтому идущие прогоны ничего не замечают.
ALTER TABLE "tg_warmup_runs" ADD COLUMN IF NOT EXISTS "pace" TEXT NOT NULL DEFAULT 'normal';
