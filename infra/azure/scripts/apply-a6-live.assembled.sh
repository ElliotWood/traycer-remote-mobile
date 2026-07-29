#!/bin/bash
# ONE-OFF, not part of the IaC: applies A6's new scripts/units to the
# ALREADY-LIVE VM without re-running bootstrap.sh's package installs /
# nginx / certbot phases. customData only runs at first boot, so the
# scripts/units this deployment's `vm.bicep` now embeds do not reach a
# VM that already exists - this script is that gap, run once via
# `az vm run-command invoke`, not committed as part of the deployment
# path (a fresh VM gets all of this from customData on first boot; this
# is only for retrofitting the VM that predates this change).
set -euo pipefail

TRAYCER_OS_USER="traycer"
TRAYCER_HOME_ROOT="/srv/traycer/tenants"

cat > /usr/local/bin/traycer-alert.sh <<'TRAYCER_ALERT_EOF'
#!/bin/bash
# The one place an A6 alert-worthy event becomes a syslog line. Every
# caller (traycer-host-alert@.service on OnFailure=, the health-probe
# timer on functional-unreachable escalation) funnels through here so
# there is exactly one message shape for the Log Analytics query
# (infra/azure/bicep/modules/monitoring.bicep) to match - two differently
# shaped alert paths is how a query ends up covering one and silently
# missing the other.
#
# Uses `logger`, not a custom log file: Azure Monitor Agent's syslog data
# source (facility local0) is the standard, low-friction way to get
# application-level events into Log Analytics - see monitoring.bicep's
# module doc for why this was chosen over a custom-text-log DCR.
set -euo pipefail

TENANT_ID="${1:?traycer-alert.sh requires a tenant id as \$1}"
REASON="${2:?traycer-alert.sh requires a reason as \$2 (unit_failed | restart_loop | functional_unreachable)}"
DETAIL="${3:-}"

logger -t traycer-alert -p local0.crit \
  "tenant=${TENANT_ID} reason=${REASON} detail=${DETAIL}"

TRAYCER_ALERT_EOF

cat > /usr/local/bin/traycer-host-failure-alert.sh <<'TRAYCER_HOSTFAIL_EOF'
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

TRAYCER_HOSTFAIL_EOF

cat > /usr/local/bin/traycer-worktree-rescue.sh <<'TRAYCER_RESCUE_EOF'
#!/bin/bash
# Recoverable-state safety net for A6's "an agent killed mid-task leaves
# recoverable state" requirement. Runs on every traycer-host@<tenant>
# failure (see traycer-host-failure-alert.sh) - snapshots any dirty git
# worktree under the tenant's HOME to a durable, reachable ref BEFORE the
# failure can compound (a restart, a later `git gc`, an operator poking
# around).
#
# NOT `git stash create` alone. That command builds a commit object and
# prints its SHA but writes no ref - the object is unreachable the moment
# this script exits and survives only until something prunes it (a `git
# gc` in the same worktree, `--prune=now`, ordinary reflog expiry). A
# safety net that reports success and holds nothing is the exact failure
# class A6 exists to prevent, so every snapshot here is immediately
# anchored with `git update-ref`, not left to `git stash store` alone.
# Written to a repo-owned namespace (`refs/traycer/rescue/...`), not
# `refs/stash`, so it cannot collide with or be silently popped by a
# human's own stash stack in the same worktree.
#
# NOT `git stash create --include-untracked` either - found live, not
# assumed: `create` (unlike `push`) does not actually implement that flag.
# It exits 0 and accepts the argument without error, but silently folds
# the literal text into the stash message instead of acting on it, so
# every untracked file - a brand new source file the agent never `git
# add`ed, exactly the mid-task state this ticket exists to protect -
# was captured by NOTHING. Caught by creating a real untracked file,
# rescuing it, and reading the resulting commit's tree, not by trusting
# the flag's name. Fixed with a scratch index (`GIT_INDEX_FILE`): `git
# add -A` against a temporary index captures tracked AND untracked state
# into a tree without ever touching the real working tree or the real
# index, then `commit-tree` + `update-ref` anchor it exactly as before.
set -euo pipefail

TENANT_ID="${1:?traycer-worktree-rescue.sh requires a tenant id as \$1}"
HOME_ROOT="${TRAYCER_HOME_ROOT:?TRAYCER_HOME_ROOT must be set}"
TENANT_HOME="${HOME_ROOT}/${TENANT_ID}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"

if [ ! -d "$TENANT_HOME" ]; then
  echo "traycer-worktree-rescue: no HOME directory for '${TENANT_ID}' - nothing to rescue" >&2
  exit 0
fi

rescued=0
# `.git` inside a worktree is a FILE pointing at the main repo's
# `.git/worktrees/<name>`, not a directory - `find ... -name .git` with no
# type filter catches both a real clone's `.git` dir and every worktree's
# `.git` file under this tenant's HOME.
while IFS= read -r -d '' git_marker; do
  worktree_dir="$(dirname "$git_marker")"
  # `|| status=$?` is load-bearing under `set -e`: a bare subshell
  # statement whose exit code is used deliberately (10 = rescued, not an
  # error) would otherwise abort this whole script the moment it returns
  # non-zero - `set -e` only exempts a command's exit status when it is
  # part of a tested construct (if/while/&&/||), and a standalone `( ... )`
  # is not one.
  status=0
  ( cd "$worktree_dir" && \
    if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
      scratch_index="$(mktemp)"
      export GIT_INDEX_FILE="$scratch_index"
      trap 'rm -f "$scratch_index"' EXIT
      parent_args=()
      if git rev-parse -q --verify HEAD >/dev/null 2>&1; then
        git read-tree HEAD
        parent_args=(-p HEAD)
      fi
      # `-A`: stages tracked modifications AND untracked files alike, all
      # into the scratch index only - the real index/working tree are
      # never touched (GIT_INDEX_FILE redirects every index operation).
      git add -A
      tree="$(git write-tree)"
      sha="$(git commit-tree "$tree" "${parent_args[@]}" -m "traycer-rescue ${TIMESTAMP}")"
      unset GIT_INDEX_FILE
      rm -f "$scratch_index"
      trap - EXIT
      if [ -n "$sha" ]; then
        ref="refs/traycer/rescue/${TENANT_ID}/${TIMESTAMP}"
        git update-ref "$ref" "$sha"
        echo "traycer-worktree-rescue: snapshotted ${worktree_dir} -> ${ref} (${sha})"
        exit 10
      fi
    fi
  ) || status=$?
  case "$status" in
    10) rescued=$((rescued + 1)) ;;
    0) ;;
    *) echo "traycer-worktree-rescue: failed to inspect ${worktree_dir}" >&2 ;;
  esac
done < <(find "$TENANT_HOME" -name ".git" -print0 2>/dev/null)

echo "traycer-worktree-rescue: done - ${rescued} worktree(s) snapshotted for '${TENANT_ID}'"

TRAYCER_RESCUE_EOF

cat > /usr/local/bin/traycer-health-probe.sh <<'TRAYCER_PROBE_EOF'
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

TRAYCER_PROBE_EOF

chmod +x /usr/local/bin/traycer-alert.sh /usr/local/bin/traycer-host-failure-alert.sh \
  /usr/local/bin/traycer-worktree-rescue.sh /usr/local/bin/traycer-health-probe.sh

cat > /etc/systemd/system/traycer-host-alert@.service <<'TRAYCER_HOSTALERT_UNIT_EOF'
[Unit]
Description=A6 failure alert for traycer-host@%i

[Service]
Type=oneshot
# Runs as root - reading `journalctl -u <unit>` (needed to tell a genuine
# restart loop from a single failure, see traycer-host-failure-alert.sh)
# requires it: the shared tenant OS user has no `systemd-journal` group
# membership, and journald refuses non-members outright ("No journal
# files were opened due to insufficient permissions" - found live, not
# assumed, when an earlier draft ran this whole unit as that user).
#
# The worktree-touching step is NOT done here, deliberately: an EARLIER
# root-run draft called traycer-worktree-rescue.sh directly from this
# root context and hit git's "detected dubious ownership" refusal the
# instant it touched a tenant-owned worktree from a different UID - a
# real bug that would have silently defeated the rescue safety net (git
# refuses rather than corrupting a read, so it failed loudly in the
# journal, but still failed). traycer-host-failure-alert.sh hands that
# one step off to the correct user via `runuser`, so root never touches
# tenant files and the rescue script never runs as an unprivileged user
# that can't read the journal - each half runs as whichever identity
# actually has the access it needs.
Environment=TRAYCER_HOME_ROOT=__TRAYCER_HOME_ROOT__
Environment=TRAYCER_OS_USER=__TRAYCER_OS_USER__
ExecStart=/usr/local/bin/traycer-host-failure-alert.sh %i

TRAYCER_HOSTALERT_UNIT_EOF

cat > /etc/systemd/system/traycer-health-probe@.service <<'TRAYCER_PROBE_UNIT_EOF'
[Unit]
Description=A6 functional health probe for tenant %i

[Service]
Type=oneshot
Environment=TRAYCER_HOME_ROOT=__TRAYCER_HOME_ROOT__
ExecStart=/usr/local/bin/traycer-health-probe.sh %i

TRAYCER_PROBE_UNIT_EOF

cat > /etc/systemd/system/traycer-health-probe@.timer <<'TRAYCER_PROBE_TIMER_EOF'
[Unit]
Description=A6 functional health probe timer for tenant %i

[Timer]
OnBootSec=60s
OnUnitActiveSec=60s
AccuracySec=5s

[Install]
WantedBy=timers.target

TRAYCER_PROBE_TIMER_EOF

sed -i "s|__TRAYCER_OS_USER__|${TRAYCER_OS_USER}|g; s|__TRAYCER_HOME_ROOT__|${TRAYCER_HOME_ROOT}|g" \
  /etc/systemd/system/traycer-host-alert@.service /etc/systemd/system/traycer-health-probe@.service

cat > /etc/systemd/system/traycer-host@.service <<'TRAYCER_UNIT_EOF'
[Unit]
Description=Traycer host process for tenant %i
# `traycer-host-guard.sh` is the enforcement point for A1's two non-negotiable
# guard rails Traycer itself does not provide (per the ticket: "refuse to
# start a second process against a HOME already in use" and "expose which
# identity each host is pinned to"). It runs as ExecStartPre, BEFORE the host
# process itself starts, so a duplicate-HOME condition is refused loudly at
# service-start time - not detected after two processes are already
# contending. See infra/azure/README.md's verification section for the
# command that proves the refusal is real, not just present in this file.
StartLimitIntervalSec=300
StartLimitBurst=5
# A6: fires on EVERY transition to `failed` - a single unrecovered crash
# AND a StartLimitBurst-exhausted restart loop alike. The triggered unit
# (traycer-host-alert@.service) is what tells the two apart by reading
# this unit's own Result= (`start-limit-hit` vs anything else), not a
# separate OnFailure= per case - see traycer-host-failure-alert.sh.
OnFailure=traycer-host-alert@%i.service

[Service]
Type=simple
# All tenants share ONE OS user (the tech plan's explicit decision - see
# infra/azure/README.md's "why one OS user" note); isolation is per-process
# HOME, never a per-tenant OS account. `User=`/`Group=` are therefore fixed
# placeholders substituted at provision time (see bootstrap.sh), not
# per-instance values - %i only ever selects the HOME directory and the log
# namespace, never the OS identity the process runs as.
User=__TRAYCER_OS_USER__
Group=__TRAYCER_OS_USER__
Environment=HOME=__TRAYCER_HOME_ROOT__/%i
# USERPROFILE is set too even though this unit only ever runs on Linux -
# `requireHomeEnv()` (clients/remote-bridge/src/host-auth.ts) checks
# USERPROFILE first on win32 and HOME everywhere else, so setting only HOME
# here is correct for THIS deployment; USERPROFILE is included anyway as
# defence against a future port of this unit template to a Windows host
# process, where omitting it would silently reintroduce the getpwuid()
# fallback bug A1 exists to prevent. Belt-and-braces, not load-bearing here.
Environment=USERPROFILE=__TRAYCER_HOME_ROOT__/%i
# Required by traycer-host-guard.sh (ExecStartPre below) - found live via
# A6 verification, not assumed: an earlier draft of this unit had no
# TRAYCER_HOME_ROOT line at all, so the guard script's own `: "${TRAYCER_HOME_ROOT:?...}"`
# check refused every single start attempt before ExecStart was ever
# reached - meaning the guard rail this ticket exists to enforce had never
# actually run successfully on any deployment. Caught by starting a real
# systemd instance and reading WHY it failed, not by re-deriving the
# contract on paper.
Environment=TRAYCER_HOME_ROOT=__TRAYCER_HOME_ROOT__
ExecStartPre=/usr/local/bin/traycer-host-guard.sh %i
# Each tenant's HOME is a self-contained Traycer install (its own
# ~/.traycer/cli/bin/traycer, its own credentials file, its own host
# install record) - the per-user CLI binary path
# clients/traycer-cli/src/service/cli-binary.ts resolves against
# `cliInstallHomeDir()`, which is `join(homedir(), ".traycer", "cli")`. This
# unit invokes that per-HOME binary directly rather than going through the
# CLI's own `service install` (systemctl --user), which assumes one OS user
# per identity - the model A1's tech plan explicitly rejected in favour of
# one shared OS user with per-process HOME.
ExecStart=__TRAYCER_HOME_ROOT__/%i/.traycer/cli/bin/traycer host start
Restart=on-failure
RestartSec=5
# Per-tenant log separation (A1's "per-tenant log separation" requirement):
# each instance's journal entries are queryable independently via
# `journalctl -u traycer-host@<tenant>`, and SyslogIdentifier keeps that
# separation visible even when aggregated (A6, a later ticket, is expected
# to ship the aggregation/alerting on TOP of this - not build its own
# separation scheme).
SyslogIdentifier=traycer-host-%i

# Defence-in-depth (not the enforcement layer - HOME is): the unit's own
# working directory is scoped to this tenant's HOME, so a bug that
# constructs a relative path incorrectly fails on a missing file inside the
# tenant's own directory rather than accidentally reading a sibling
# tenant's.
WorkingDirectory=__TRAYCER_HOME_ROOT__/%i

# Boot survival (A1's "boot survival" requirement) is granted by `enable`,
# done per-tenant by bootstrap.sh - this unit file does not enable itself.
[Install]
WantedBy=multi-user.target

TRAYCER_UNIT_EOF
sed -i "s|__TRAYCER_OS_USER__|${TRAYCER_OS_USER}|g; s|__TRAYCER_HOME_ROOT__|${TRAYCER_HOME_ROOT}|g" \
  /etc/systemd/system/traycer-host@.service

systemctl daemon-reload
echo "apply-a6-live: done"
