#!/usr/bin/env bash
set -euo pipefail
cd /srv/skyseo/front
export PATH="/opt/skyseo-node/bin:$PATH"
export NODE_OPTIONS=--max-old-space-size=1400
export NEXT_PUBLIC_API_URL=/v1/api
export NEXT_TELEMETRY_DISABLED=1
export NPM_CONFIG_CACHE=/srv/skyseo/.npm-cache
npm ci --no-audit --no-fund
npm run build
cp -a public .next/standalone/public
mkdir -p .next/standalone/.next
cp -a .next/static .next/standalone/.next/static
printf 'SkySEO landing build completed\n'
