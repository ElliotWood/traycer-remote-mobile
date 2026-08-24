#!/usr/bin/env bash
# SENTINEL: TEAMSBOT_NGINX_FIX2
#
# Repairs a breakage I caused: `vm-nginx-route.sh` wrote its backups as
# `/etc/nginx/sites-enabled/traycer.bak.<ts>`, and nginx.conf includes
# `sites-enabled/*` — so every backup was loaded as an ADDITIONAL server
# block with the same `server_name`. That produced:
#   [warn]  conflicting server name "..." on 0.0.0.0:443, ignored
#   [emerg] could not build server_names_hash ... bucket_size: 64
# The bucket-size error was a symptom, not the cause; raising it to 128 did
# not help because the duplicate server blocks were the actual problem.
#
# nginx was never reloaded with the failing config, so /rpc and /stream have
# been served by the last-known-good config throughout.
set -uo pipefail

# Hostname is deployment-specific: never hardcoded in an OSS repo.
if [ -z "${PUBLIC_HOSTNAME:-}" ]; then
  echo "PUBLIC_HOSTNAME is required" >&2; exit 1
fi

echo "SENTINEL_START TEAMSBOT_NGINX_FIX2"
BACKUP_DIR=/root/nginx-backups
mkdir -p "$BACKUP_DIR"

echo "=== files nginx is including from sites-enabled ==="
ls -1 /etc/nginx/sites-enabled/

# Move every backup OUT of the included directory.
moved=0
for f in /etc/nginx/sites-enabled/*.bak.*; do
  [ -e "$f" ] || continue
  mv "$f" "$BACKUP_DIR/"
  moved=$((moved + 1))
done
echo "moved $moved backup file(s) out of sites-enabled -> $BACKUP_DIR"

echo "=== sites-enabled after cleanup ==="
ls -1 /etc/nginx/sites-enabled/

echo "=== route present exactly once? ==="
echo "location /api/messages count: $(grep -c 'location /api/messages' /etc/nginx/sites-enabled/traycer)"

echo "=== nginx -t ==="
nginx -t 2>&1 | tail -3
if nginx -t >/dev/null 2>&1; then
  systemctl reload nginx && echo "RELOADED"
else
  echo "STILL INVALID — not reloaded; live config untouched"
  echo "SENTINEL_END TEAMSBOT_NGINX_FIX2"
  exit 1
fi

echo "=== probes ==="
curl -s -m 8 -o /dev/null -w "loopback /healthz                  : %{http_code}\n" http://127.0.0.1:3978/healthz
curl -s -m 10 -X POST -o /dev/null -w "public   /api/messages unauth (403 expected): %{http_code}\n" \
  -H 'content-type: application/json' -d '{"type":"message"}' \
  "https://${PUBLIC_HOSTNAME}/api/messages"
curl -s -m 10 -o /dev/null -w "public   /rpc (must remain reachable)      : %{http_code}\n" \
  "https://${PUBLIC_HOSTNAME}/rpc"
echo "SENTINEL_END TEAMSBOT_NGINX_FIX2"
