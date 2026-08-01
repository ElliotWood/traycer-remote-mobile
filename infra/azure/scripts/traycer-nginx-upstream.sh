#!/bin/bash
# Regenerate nginx's `traycer_host` upstream from a tenant's pid.json.
#
# WHY THIS EXISTS
# The Traycer host binds an EPHEMERAL port, chosen fresh on every start. A port
# written into the nginx config is correct exactly until the host restarts, and
# then /rpc and /stream fail with no signal that anything changed - the failure
# presents as a client bug, not a config one. Observed within four minutes of
# wiring a port by hand on the live VM: 45731 -> 36705.
#
# Driven by traycer-nginx-upstream.path (a systemd .path unit on pid.json), so
# a host restart heals itself rather than needing an operator.
#
# Usage: traycer-nginx-upstream.sh <tenant-id>
set -euo pipefail

TENANT="${1:?tenant id required}"
PIDFILE="/srv/traycer/tenants/${TENANT}/.traycer/host/pid.json"
OUT="/etc/nginx/conf.d/traycer-upstream.conf"
# Deliberately a closed port, not a removed upstream: nginx will not load a
# config referencing an undefined upstream, so "no host yet" must still emit a
# valid one. A closed port yields 502 - honest - where omitting the file
# entirely would take the whole site down.
NO_HOST_PORT="1"

if [ ! -f "$PIDFILE" ]; then
  echo "traycer-nginx-upstream: no pid.json for '${TENANT}' - pointing upstream at a closed port (502)" >&2
  PORT="$NO_HOST_PORT"
else
  PORT="$(node -e "console.log(new URL(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).websocketUrl).port)" "$PIDFILE" 2>/dev/null || echo "")"
fi

if ! [[ "$PORT" =~ ^[0-9]+$ ]]; then
  echo "traycer-nginx-upstream: refusing - unparseable port '${PORT}' from ${PIDFILE}" >&2
  exit 1
fi

NEW="upstream traycer_host { server 127.0.0.1:${PORT}; }"
if [ -f "$OUT" ] && [ "$(cat "$OUT")" = "$NEW" ]; then
  exit 0
fi

echo "$NEW" > "$OUT"
if nginx -t >/dev/null 2>&1; then
  systemctl reload nginx
  echo "traycer-nginx-upstream: ${TENANT} host port -> ${PORT}, nginx reloaded"
else
  echo "traycer-nginx-upstream: generated config failed nginx -t - not reloading" >&2
  exit 1
fi
