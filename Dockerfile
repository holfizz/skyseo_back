FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

# --omit=optional обязателен. @mtcute/convert (разбор tdata в модуле прогрева)
# объявляет @mtcute/node необязательной одноранговой зависимостью, а npm такие
# ставит сам. Тот тянет better-sqlite3 — нативный модуль без сборок под musl,
# и npm ci уходил в node-gyp, не находил Python и валил сборку:
#   gyp ERR! find Python  Could not find any Python installation to use
# Криптографию для tdata мы делаем сами (src/tg-warmup/tdata-crypto.ts), так что
# @mtcute/node не нужен. Проверено: ВСЕ необязательные пакеты в проде тянутся
# из этого же поддерева, ничего другого флаг не отсекает. Если появится новая
# зависимость с нужной необязательной частью — это условие надо перепроверить.
RUN npm ci --omit=optional

COPY . .

RUN npx prisma generate
RUN npm run build

FROM node:20-alpine

WORKDIR /app

# Fix Alpine mirrors and install openssl
# chromium — для генерации PDF-отчётов (src/report). Ставим системный:
# puppeteer-core своего браузера не несёт, а полный puppeteer тянул бы
# ещё ~200 МБ и всё равно не запустился бы на musl.
# nss/freetype/harfbuzz/ttf-freefont — минимум, без которого chromium
# падает при старте; сам текст отчёта рисуется встроенным шрифтом Helio.
RUN apk update && apk add --no-cache \
	openssl \
	chromium \
	nss \
	freetype \
	harfbuzz \
	ca-certificates \
	ttf-freefont

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package*.json ./

EXPOSE 3000

CMD ["sh", "-c", "npx prisma migrate deploy && npm run start:prod"]
