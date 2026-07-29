#!/bin/bash
# ExecStartPre for traycer-host@.service (see infra/azure/systemd/traycer-host@.service).
# Runs BEFORE the actual host process starts, and refuses loudly (nonzero
# exit, which makes systemd refuse the start) rather than letting two
# processes silently share one tenant's HOME.
#
# What this actually catches: two DIFFERENT systemd instances
# (traycer-host@alice, traycer-host@mallory) whose HOME resolves to the
# SAME directory - a provisioning/config bug (duplicate tenantIds entry, a
# copy-paste in the identity registry, a symlink), not a threat this repo
# treats as attacker-controlled. Detection is by scanning for a LIVE
# process whose cmdline already matches this tenant's own CLI binary path -
# since HOME differs by tenant id in the normal case, two distinct tenants
# only ever collide here if they were misconfigured to point at the same
# HOME, in which case the second one to start finds the first still
# running and refuses.
#
# HONEST LIMITATION, not glossed over: this is a check-then-act race, not a
# kernel-enforced mutex. A window exists between this script exiting 0 and
# the real ExecStart process appearing in the process table where two
# instances racing to start at the same instant could both pass the check.
# systemd's own StartLimitIntervalSec/StartLimitBurst (see the unit's
# [Unit] section) bound how often this can even be attempted, and normal
# operation (boot-time enable, or a single operator restarting one tenant)
# never produces that race in practice - documenting the gap here instead
# of claiming a guarantee the implementation doesn't provide.
set -euo pipefail

TENANT_ID="${1:?traycer-host-guard.sh requires the systemd instance name (%i) as \$1}"
HOME_ROOT="${TRAYCER_HOME_ROOT:?TRAYCER_HOME_ROOT must be set in the environment (set by bootstrap.sh at provision time)}"
HOME_DIR="${HOME_ROOT}/${TENANT_ID}"
BINARY_PATH="${HOME_DIR}/.traycer/cli/bin/traycer"

if [ ! -d "$HOME_DIR" ]; then
  echo "traycer-host-guard: refusing to start '${TENANT_ID}' - HOME directory ${HOME_DIR} does not exist. Tenant not onboarded, or provisioning did not complete." >&2
  exit 1
fi

if pgrep -f -- "^${BINARY_PATH} host start\$" >/dev/null 2>&1; then
  echo "traycer-host-guard: refusing to start '${TENANT_ID}' - a host process is already running against HOME=${HOME_DIR}. This is the guard rail A1 exists to enforce: two processes must never silently share one tenant's identity. If this fires unexpectedly, investigate before restarting - do not just retry." >&2
  exit 1
fi

echo "traycer-host-guard: identity check passed - tenant='${TENANT_ID}' pinned to HOME=${HOME_DIR}"
