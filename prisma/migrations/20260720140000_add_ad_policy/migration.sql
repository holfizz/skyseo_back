-- Аддитивно: режим показа рекламы в выдаче для сайта (EXCLUDE | ONLY | ALL)
ALTER TABLE "websites" ADD COLUMN "adPolicy" TEXT NOT NULL DEFAULT 'EXCLUDE';
