-- The opening H5 text has already been sent. Keep it and its statistics intact;
-- only make the previously absent, manually sent reply available. If another
-- reply was sent or an editor has supplied one in the meantime, leave it alone.
UPDATE "tg_hypotheses" AS h
SET "hasSecondMessage" = true,
    "secondMessage" = $h5$Да, конечно. Посмотрел позиции {сайт} в сохраненной выдаче Яндекса: {позиции}. Среди конкурентов в выдаче вижу {конкуренты}.

Занимаюсь SEO и видимостью в ответах нейросетей. Наша задача — чтобы Алиса, ChatGPT и другие сервисы чаще рекомендовали вас по профильным вопросам. По вашему сайту эту часть пока отдельно не проверял.

Давайте созвонимся на 10–15 минут: покажу позиции и конкурентов на экране, расскажу, что можно улучшить в первую очередь. Когда вам удобно?$h5$
WHERE h."id" = 'hyp-2026-10-call-h5-joke'
  AND h."hasSecondMessage" = false
  AND h."secondMessage" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "tg_recipients" AS r
    WHERE r."hypothesisId" = h."id" AND r."secondSentAt" IS NOT NULL
  );
