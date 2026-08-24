#!/usr/bin/env bash
# Diagnoses and repairs the nginx state after the /api/messages insert.
#
# Two things went wrong and this handles both:
#  1. Concurrent run-command invocations may each have inserted the location
#     block, so it can appear more than once.
#  2. `nginx -t` fails with "could not build server_names_hash, you should
#     increase server_names_hash_bucket_size: 64" — the FQDN
#     (${PUBLIC_HOSTNAME}, 54 chars)
#     exceeds what a 64-byte bucket holds once hashed alongside the others.
#
# nginx was NEVER reloaded with the failing config, so the live host's /rpc
# and /stream have been serving the last-known-good config throughout.
set -uo pipefail

# Hostname is deployment-specific: never hardcoded in an OSS repo.
if [ -z "${PUBLIC_HOSTNAME:-}" ]; then
  echo "PUBLIC_HOSTNAME is required" >&2; exit 1
fi

SITE=/etc/nginx/sites-enabled/traycer

echo "=== diagnosis ==="
echo "api/messages occurrences: $(grep -c 'api/messages' "$SITE" 2>/dev/null || echo 0)"
echo "server_name occurrences:  $(grep -c 'server_name' "$SITE" 2>/dev/null || echo 0)"
echo "total lines:              $(wc -l < "$SITE")"
echo "backups: $(find "$(dirname "$SITE")" -maxdepth 1 -name "$(basename "$SITE").bak.*" | wc -l)"

# If the location got inserted more than once, restore the OLDEST backup
# (pre-any-insert) and redo the insert exactly once.
COUNT=$(grep -c 'location /api/messages' "$SITE" 2>/dev/null || echo 0)
if [ "$COUNT" -gt 1 ]; then
  OLDEST=$(find "$(dirname "$SITE")" -maxdepth 1 -name "$(basename "$SITE").bak.*" -printf '%T@ %p\n' | sort -n | head -1 | cut -d' ' -f2-)
  echo "duplicate location blocks ($COUNT) — restoring $OLDEST and reinserting once"
  cat "$OLDEST" > "$SITE"
  cat > /tmp/botloc.conf <<'LOC'
    location /api/messages {
        proxy_pass http://127.0.0.1:3978/api/messages;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 1m;
    }

LOC
  awk '
    !ins && /^[[:space:]]*location \/ \{/ {
      while ((getline line < "/tmp/botloc.conf") > 0) print line
      ins = 1
    }
    { print }
  ' "$SITE" > /tmp/site.new && cat /tmp/site.new > "$SITE"
  echo "reinserted; now $(grep -c 'location /api/messages' "$SITE") occurrence(s)"
fi

# Raise the bucket size in the http{} block of nginx.conf (idempotent).
if grep -q 'server_names_hash_bucket_size' /etc/nginx/nginx.conf; then
  sed -i 's/server_names_hash_bucket_size[[:space:]]*[0-9]*;/server_names_hash_bucket_size 128;/' /etc/nginx/nginx.conf
  echo "bucket size updated to 128"
else
  sed -i '0,/^http {/s//http {\n\tserver_names_hash_bucket_size 128;/' /etc/nginx/nginx.conf
  echo "bucket size directive added (128)"
fi

echo "=== nginx -t ==="
nginx -t 2>&1 | tail -3
if nginx -t >/dev/null 2>&1; then
  systemctl reload nginx && echo "RELOADED"
else
  echo "STILL INVALID — not reloaded (live config unchanged, /rpc and /stream unaffected)"
  exit 1
fi

echo "=== probes ==="
curl -s -m 8 -o /dev/null -w "loopback  /healthz          : %{http_code}\n" http://127.0.0.1:3978/healthz
curl -s -m 10 -X POST -o /dev/null -w "public    /api/messages (403=good, means bot reached and rejected unauth): %{http_code}\n" \
  -H 'content-type: application/json' -d '{"type":"message"}' \
  "https://${PUBLIC_HOSTNAME}/api/messages"
curl -s -m 10 -o /dev/null -w "public    /rpc (must still be reachable): %{http_code}\n" \
  "https://${PUBLIC_HOSTNAME}/rpc"
