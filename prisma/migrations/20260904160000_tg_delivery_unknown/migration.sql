-- Отправка с неизвестным исходом: сообщение могло уйти, подтверждения нет.
-- Такие строки не возвращаются в очередь, иначе адресат получит второе письмо.
ALTER TABLE "tg_recipients" ADD COLUMN IF NOT EXISTS "deliveryUnknown" BOOLEAN NOT NULL DEFAULT false;
