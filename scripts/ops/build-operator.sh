#!/usr/bin/env bash
set -euo pipefail
cd /srv/skyseo/back
export PATH="/opt/skyseo-node/bin:$PATH"
export NODE_OPTIONS=--max-old-space-size=1200
export NPM_CONFIG_CACHE=/srv/skyseo/.npm-cache
npm ci --no-audit --no-fund
npm run prisma:generate
npm run build
