#!/usr/bin/env bash
# Veröffentlicht die Reisebande.
#  1. Worker "reisebande": nur für das stündliche Abendbriefing (Cron), ohne öffentliche Adresse.
#  2. Pages-Projekt "reisebande": die App unter https://reisebande.pages.dev (Worker-Bundle als _worker.js).
# Der Pages-Upload läuft direkt über die API, weil wrangler pages deploy in Cloud-Sessions am Proxy scheitert.
# Braucht CLOUDFLARE_ACCOUNT_ID und ein API-Token (in Cloud-Sessions setzt der Proxy das Token ein).
set -euo pipefail
cd "$(dirname "$0")/.."
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID fehlt}"
export CLOUDFLARE_API_TOKEN="${CLOUDFLARE_API_TOKEN:-proxy-injected}" WRANGLER_SEND_METRICS=false
OUT="$(mktemp -d)"
node scripts/build-static.mjs
npx wrangler deploy
npx wrangler deploy --dry-run --outdir "$OUT" >/dev/null
curl -sS -X POST "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/reisebande/deployments" \
  ${CLOUDFLARE_API_TOKEN:+-H "authorization: Bearer $CLOUDFLARE_API_TOKEN"} \
  -F 'manifest={}' -F 'branch=main' -F "commit_message=$(git log -1 --format=%s 2>/dev/null || echo Deploy)" -F 'commit_dirty=true' \
  -F "_worker.js=@$OUT/worker.js;filename=_worker.js;type=application/javascript+module" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print('Pages:', 'ok' if d['success'] else d['errors'])"
rm -rf "$OUT"
