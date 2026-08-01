#!/usr/bin/env bash
# Adds the `/api/messages` location to the existing nginx `traycer` site so
# Azure Bot Service can reach the bot on loopback:3978.
#
# Uses awk rather than sed: an earlier sed version used `s#...#...#` while the
# inserted block itself contained `#` comment characters, which collided with
# the delimiter ("unknown option to `s'"). awk inserts a literal block with no
# delimiter or escaping semantics at all.
#
# Idempotent. Always `nginx -t` before reloading and never leave a broken
# config in place — this same server block also fronts the live Traycer
# host's /rpc and /stream, so a bad reload would take those down too.
set -euo pipefail

# Hostname is deployment-specific: never hardcoded in an OSS repo.
if [ -z "${PUBLIC_HOSTNAME:-}" ]; then
  echo "PUBLIC_HOSTNAME is required" >&2; exit 1
fi

SITE=/etc/nginx/sites-enabled/traycer

if grep -q "api/messages" "$SITE"; then
  echo "route already present — no change"
else
  cp "$SITE" "$SITE.bak.$(date +%s)"

  cat > /tmp/botloc.conf <<'LOC'
    location /api/messages {
        proxy_pass http://127.0.0.1:3978/api/messages;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 1m;
    }

LOC

  # Insert the block immediately before the FIRST `location / {`, which is
  # the TLS server block's catch-all. `done` guards against also matching the
  # port-80 redirect block's own `location /`.
  awk '
    !done && /^[[:space:]]*location \/ \{/ {
      while ((getline line < "/tmp/botloc.conf") > 0) print line
      done = 1
    }
    { print }
  ' "$SITE" > /tmp/traycer.site.new

  if ! grep -q "api/messages" /tmp/traycer.site.new; then
    echo "INSERT FAILED — no anchor matched; leaving config untouched"
    exit 1
  fi
  cat /tmp/traycer.site.new > "$SITE"
  echo "route inserted"
fi

echo "=== nginx -t ==="
if nginx -t 2>&1 | tail -2; then
  systemctl reload nginx && echo "nginx reloaded"
else
  echo "CONFIG INVALID — not reloaded"
  exit 1
fi

echo "=== public probes through real TLS ==="
curl -s -m 10 -o /dev/null -w "GET /healthz (expect 404 — deliberately NOT public): %{http_code}\n" \
  https://${PUBLIC_HOSTNAME}/healthz || true
curl -s -m 10 -X POST -o /dev/null -w "POST /api/messages unauthenticated (expect 403): %{http_code}\n" \
  -H "content-type: application/json" -d '{"type":"message"}' \
  https://${PUBLIC_HOSTNAME}/api/messages || true
