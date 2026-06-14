-- Флаг «крутить всегда по максимуму сети» (динамический потолок ceil(среднее ПК/день / 14))
ALTER TABLE "websites" ADD COLUMN "autoMaxVisits" BOOLEAN NOT NULL DEFAULT false;
