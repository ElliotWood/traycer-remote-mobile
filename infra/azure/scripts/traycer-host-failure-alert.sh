#!/bin/bash
# Invoked by traycer-host-alert@.service, which traycer-host@.service's
# OnFailure= triggers whenever the host unit for one tenant enters
# `failed` - both on a single unrecovered crash AND when
# StartLimitIntervalSec/StartLimitBurst (see traycer-host@.service's
# [Unit] section) gives up on a restart loop. systemd already tracks the
# attempt budget; this script's only job is reading which of the two
# happened and labelling the alert accordingly, not re-implementing the
# budget itself (see infra/azure/README.md's A6 section for why).
set -euo pipefail

TENANT_ID="${1:?traycer-host-failure-alert.sh requires a tenant id as \$1}"
TRAYCER_OS_USER="${TRAYCER_OS_USER:?TRAYCER_OS_USER must be set}"
TRAYCER_HOME_ROOT="${TRAYCER_HOME_ROOT:?TRAYCER_HOME_ROOT must be set}"
UNIT="traycer-host@${TENANT_ID}.service"

RESULT="$(systemctl show "$UNIT" --property=Result --value 2>/dev/null || echo "unknown")"
N_RESTARTS="$(systemctl show "$UNIT" --property=NRestarts --value 2>/dev/null || echo "unknown")"

# NOT `Result= == "start-limit-hit"`. Verified live against a real
# restart loop, not assumed: `systemctl show --property=Result` still
# reads `exit-code` at the exact moment OnFailure= fires for a
# StartLimitBurst-exhausted attempt - the property reflects the
# underlying process failure, not the higher-level rate-limit rejection,
# so this check never actually fired. journald's own
# "Start request repeated too quickly" line is the real, distinguishing
# signal - it appears in this unit's journal in the same burst of lines
# as the triggering failure, so a narrow recent-lines grep catches it
# reliably without matching an unrelated OLDER restart-loop days ago.
if journalctl -u "$UNIT" -n 5 --no-pager --output=cat 2>/dev/null | grep -q "Start request repeated too quickly"; then
  REASON="restart_loop"
else
  REASON="unit_failed"
fi

/usr/local/bin/traycer-alert.sh "$TENANT_ID" "$REASON" "result=${RESULT} nrestarts=${N_RESTARTS}"

# Recoverable-state safety net runs on every failure, not only restart
# loops - a single unexpected crash is exactly when uncommitted worktree
# state is most at risk, and running it unconditionally means one code
# path to test rather than two.
#
# `runuser -u`, not root: the tenant's worktrees are owned by
# TRAYCER_OS_USER, and git refuses to operate across that ownership
# boundary ("detected dubious ownership") - see this script's own unit
# file for how that was found.
runuser -u "$TRAYCER_OS_USER" -- env TRAYCER_HOME_ROOT="$TRAYCER_HOME_ROOT" \
  /usr/local/bin/traycer-worktree-rescue.sh "$TENANT_ID" || \
  /usr/local/bin/traycer-alert.sh "$TENANT_ID" "rescue_failed" "traycer-worktree-rescue.sh exited non-zero - see journalctl -u traycer-host-alert@${TENANT_ID}"
