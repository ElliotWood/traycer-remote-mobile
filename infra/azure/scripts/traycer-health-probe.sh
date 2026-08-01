#!/bin/bash
# The check systemd cannot provide: "is this host actually serving",
# not "does the process exist". A process can hold its cgroup (systemd
# reports `active`) while its event loop is completely wedged - the exact
# shape of today's four false-positive-liveness incidents (see
# infra/azure/README.md's A6 section). Runs on a timer
# (traycer-health-probe@.timer), NOT on every OnFailure= - a crash
# systemd already sees and restarts; this catches the case systemd can't.
#
# TCP-connect only, not a full WebSocket handshake - mirrors
# clients/desktop/src/electron-main/host/host-lifecycle.ts's own
# `canReachHostWebsocketUrl` exactly (its own comment: "the real TCP
# connect"), the same reachability bar the desktop's watchdog already
# uses and was reviewed against.
#
# Never escalates on the first failure. A busy-but-alive host (the
# desktop's own hard-won lesson: v1.1.8-rc.2 killed healthy hosts in a
# loop by treating a stall as death) gets CONSECUTIVE_FAILURES_TO_ALERT
# chances, tracked in a state file, before this is treated as more than
# a blip.
set -euo pipefail

TENANT_ID="${1:?traycer-health-probe.sh requires a tenant id as \$1}"
HOME_ROOT="${TRAYCER_HOME_ROOT:?TRAYCER_HOME_ROOT must be set}"
TENANT_HOME="${HOME_ROOT}/${TENANT_ID}"
PID_FILE="${TENANT_HOME}/.traycer/host/pid.json"
STATE_FILE="/run/traycer-health-probe/${TENANT_ID}.count"
CONSECUTIVE_FAILURES_TO_ALERT=3

mkdir -p "$(dirname "$STATE_FILE")"

# systemd's own view first: if the unit isn't even active, this tenant's
# process-death handling is traycer-host-failure-alert.sh's job (via
# OnFailure=), not this probe's - alerting twice for one root cause would
# make the alert stream noisier, not more informative.
if ! systemctl is-active --quiet "traycer-host@${TENANT_ID}.service"; then
  rm -f "$STATE_FILE"
  exit 0
fi

if [ ! -f "$PID_FILE" ]; then
  # Active per systemd but no pid.json yet - normal during the brief
  # window right after start, before the host has bound. Not a failure.
  exit 0
fi

WEBSOCKET_URL="$(grep -o '"websocketUrl"[[:space:]]*:[[:space:]]*"[^"]*"' "$PID_FILE" 2>/dev/null | sed -E 's/.*"(ws:\/\/[^"]*)".*/\1/' || true)"
if [ -z "$WEBSOCKET_URL" ]; then
  exit 0
fi

HOST_PORT="$(echo "$WEBSOCKET_URL" | sed -E 's#^ws://([^/]+)/.*#\1#')"
HOST="${HOST_PORT%%:*}"
PORT="${HOST_PORT##*:}"

if timeout 5 bash -c "exec 3<>/dev/tcp/${HOST}/${PORT}" 2>/dev/null; then
  rm -f "$STATE_FILE"
  exit 0
fi

count=0
[ -f "$STATE_FILE" ] && count="$(cat "$STATE_FILE" 2>/dev/null || echo 0)"
count=$((count + 1))
echo "$count" > "$STATE_FILE"

if [ "$count" -ge "$CONSECUTIVE_FAILURES_TO_ALERT" ]; then
  /usr/local/bin/traycer-alert.sh "$TENANT_ID" "functional_unreachable" \
    "systemd reports active, ${count} consecutive TCP-connect failures to ${WEBSOCKET_URL}"
  # Reset after alerting so a sustained outage doesn't re-alert on every
  # tick - the alert already fired; the state file's job here is
  # debounce, not a running total.
  rm -f "$STATE_FILE"
fi
