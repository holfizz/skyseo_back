#!/usr/bin/env bash
set -euo pipefail
case " ${RENEWED_DOMAINS:-} " in
  *' skyseo.site '*) nginx -t && systemctl reload nginx ;;
esac
