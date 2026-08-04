#!/bin/bash
# A6 probe for the Claude-agent execution surface: the `claude` binary, the
# per-tenant credential, and the repo checkout agents actually work in.
#
# TWO MODES, because the check that matters costs money.
#
#   structural (default)  - free. Binary runs, credential file exists and is
#                           non-empty, repo git is healthy AS THE OWNING USER.
#   spawn (--spawn)       - invokes `claude` for real and requires a sentinel
#                           back. Consumes Claude quota on every run.
#
# WHY THE SPLIT IS THE WHOLE DESIGN
# A structural check cannot tell a live credential from a dead one. An
# expired or revoked `.claude.json` is present, 0600, non-empty, and
# parses - it passes every cheap check while every agent spawn fails on
# auth. That is this surface's hollow-green case, and only a real
# invocation catches it.
#
# But the deployment shares ONE Claude Max account across N people (see
# A7), so a probe that spawns an agent every couple of minutes would eat
# the quota it is supposed to protect - monitoring that causes the outage
# it watches for.
#
# THE RESOLUTION, and this paragraph replaces one that said `--spawn` is
# "NOT on a timer by default". That was written before the timer existed and
# has been stale since traycer-agent-spawn-probe@.timer landed; bootstrap.sh
# now enables it, so a file saying "not scheduled" beside a script that
# schedules it would leave the next reader to work out which one is lying.
#
# `--spawn` IS scheduled, at a cadence chosen to answer the objection above
# rather than to ignore it: 6-hourly and jittered, so 4 runs per tenant per
# day - not the structural probe's few-minute cadence. The quota decision is
# real and is recorded in traycer-agent-spawn-probe@.service and at the
# `systemctl enable` in bootstrap.sh; it is made in the deploy path where it
# can be reversed in one place, rather than left to whoever remembers to
# enable a unit by hand.
#
# Exit: 0 healthy, 1 alertable, 2 usage error.
set -uo pipefail

TENANT_ID="${1:?traycer-agent-probe.sh requires a tenant id as \$1}"
MODE="${2:-structural}"
HOME_ROOT="${TRAYCER_HOME_ROOT:?TRAYCER_HOME_ROOT must be set}"
OS_USER="${TRAYCER_OS_USER:-traycer}"
REPO_ROOT="${TRAYCER_REPO_ROOT:-/srv/traycer/repo}"
TENANT_HOME="${HOME_ROOT}/${TENANT_ID}"
CLAUDE_BIN="${TRAYCER_CLAUDE_BIN:-/usr/local/bin/claude}"

fail() { echo "agent-probe: FAIL $1" >&2; exit 1; }

[ -d "$TENANT_HOME" ] || fail "no HOME for tenant '${TENANT_ID}' at ${TENANT_HOME}"

# 1. Binary actually executes. `--version` rather than `-f`: a truncated or
#    partially-written binary is present-but-unusable, and a file test would
#    call that healthy.
"$CLAUDE_BIN" --version >/dev/null 2>&1 || fail "${CLAUDE_BIN} did not execute (--version failed)"

# 2. Credential must be CONFIGURED and DELIVERED.
#
#    This deployment authenticates the harness with `claude setup-token`,
#    which prints a long-lived OAuth token and PERSISTS NOTHING. There is
#    no credentials file to look for, by design. The token lives in
#    /etc/traycer/claude.env as CLAUDE_CODE_OAUTH_TOKEN and reaches the
#    harness through a systemd drop-in's `EnvironmentFile=`.
#
#    TWO EARLIER DRAFTS OF THIS CHECK WERE BOTH WRONG, in opposite
#    directions, and the pair is the lesson:
#      - `[ -s ~/.claude.json ]` was a false GREEN: that file is first-run
#        scaffolding Claude Code writes whether or not anyone
#        authenticated (0600, 389 bytes, valid JSON, telemetry keys only).
#      - Then requiring an auth-bearing key in it was a false RED: under
#        `setup-token` that file NEVER gains one, and a bare `claude -p`
#        from a shell without the env var ALWAYS says "Not logged in".
#        Strictness aimed at the wrong mechanism is not rigour.
#    So this now checks the mechanism actually in use, verified against
#    the live box (env file mode/owner, key presence, and the variable
#    present in the running host's /proc/<pid>/environ).
#
#    Never reads, prints, or logs the token VALUE - only key presence and
#    value length - so this cannot leak a credential into the journal or
#    into Log Analytics.
CLAUDE_ENV_FILE="${TRAYCER_CLAUDE_ENV:-/etc/traycer/claude.env}"

# 2a. Configured: the env file defines a non-empty token.
if [ ! -f "$CLAUDE_ENV_FILE" ]; then
  fail "no Claude credential for '${TENANT_ID}': ${CLAUDE_ENV_FILE} does not exist. The harness is authenticated by CLAUDE_CODE_OAUTH_TOKEN from that file (via a traycer-host@.service.d drop-in), NOT by any credentials file - \`claude setup-token\` persists nothing."
fi
if [ ! -r "$CLAUDE_ENV_FILE" ]; then
  # Unreadable is INCONCLUSIVE, not healthy. The file is 0600 root:root, so
  # this fires if the probe is ever run as a non-root user rather than
  # meaning the credential is missing - named separately so the alert does
  # not send someone hunting for a credential that is fine.
  fail "cannot verify the Claude credential for '${TENANT_ID}': ${CLAUDE_ENV_FILE} exists but is unreadable by $(id -un). It is 0600 root:root by design - this probe must run as root."
fi
TOKEN_LEN="$(awk -F= '/^CLAUDE_CODE_OAUTH_TOKEN=/{print length($2); exit}' "$CLAUDE_ENV_FILE")"
if [ -z "${TOKEN_LEN:-}" ] || [ "$TOKEN_LEN" -eq 0 ]; then
  fail "no usable Claude credential for '${TENANT_ID}': ${CLAUDE_ENV_FILE} does not define a non-empty CLAUDE_CODE_OAUTH_TOKEN."
fi

# 2b. Delivered: the running host actually carries the variable.
#
#     This is the half a config check cannot give you. A correct env file
#     plus a host process that started BEFORE the drop-in landed (or
#     without a `daemon-reload`) is a running harness with no credential -
#     config green, capability absent. Only inspected when the host is up;
#     a down host is the health probe's business, not this one's.
HOST_PID="$(systemctl show -p MainPID --value "traycer-host@${TENANT_ID}.service" 2>/dev/null || echo 0)"
if [ -n "$HOST_PID" ] && [ "$HOST_PID" != "0" ] && [ -r "/proc/${HOST_PID}/environ" ]; then
  if ! tr '\0' '\n' < "/proc/${HOST_PID}/environ" | grep -q '^CLAUDE_CODE_OAUTH_TOKEN=.'; then
    fail "Claude credential is configured in ${CLAUDE_ENV_FILE} but did NOT reach the running host process for '${TENANT_ID}' (pid ${HOST_PID}). The harness cannot authenticate. Most likely the host started before the traycer-host@.service.d drop-in landed - 'systemctl daemon-reload && systemctl restart traycer-host@${TENANT_ID}' should fix it."
  fi
fi

# 3. Repo git health AS THE OWNING USER, not as whoever runs this. Two
#    separate bugs today came from crossing that boundary: git's "detected
#    dubious ownership" refusal, and `sudo` inheriting a root-only cwd so
#    git died before contacting GitHub - which reads exactly like an auth
#    failure and is not one. Hence `cd /` plus runuser.
if [ -d "$REPO_ROOT" ]; then
  while IFS= read -r -d '' marker; do
    d="$(dirname "$marker")"
    ( cd / && runuser -u "$OS_USER" -- git -C "$d" rev-parse --abbrev-ref HEAD >/dev/null 2>&1 ) || \
      fail "repo ${d} is not readable by ${OS_USER} (ownership or corruption) - agents cannot work in it"
  done < <(find "$REPO_ROOT" -maxdepth 3 -name ".git" -print0 2>/dev/null)
fi

if [ "$MODE" != "--spawn" ]; then
  echo "agent-probe: OK structural checks passed for '${TENANT_ID}' (binary; CLAUDE_CODE_OAUTH_TOKEN configured and delivered to the host; repo git). Token VALIDITY not proven - run with --spawn for that, at quota cost."
  exit 0
fi

# 4. Real spawn. Asserts on a SENTINEL in the output, never on exit code
#    alone: `claude` can exit 0 having produced an error message, and this
#    project has already been burned by a probe that read output it did not
#    own. A marker the prompt itself demands is the only proof the model
#    actually answered.
#    Must carry CLAUDE_CODE_OAUTH_TOKEN in explicitly. Without it `claude`
#    reports "Not logged in" no matter how healthy the deployment is -
#    which is exactly the false-red an earlier draft of this script built a
#    whole check around.
SENTINEL="A6PROBE$(date -u +%s)"
# shellcheck disable=SC1090
CLAUDE_CODE_OAUTH_TOKEN="$(awk -F= '/^CLAUDE_CODE_OAUTH_TOKEN=/{sub(/^CLAUDE_CODE_OAUTH_TOKEN=/,"");print;exit}' "$CLAUDE_ENV_FILE")"

# FRESH HOME PER RUN, not the tenant's own. Two reasons, the first learned
# the hard way by the agent that wired this credential up:
#
#  1. Session anchoring. A chat that once attempted a turn pre-auth stays
#     anchored to that provider session, and every later retry re-resumes
#     it and returns `status=interrupted` with no work done - green
#     credential, red turn, for reasons that have nothing to do with the
#     token. A probe sharing the tenant's ~/.claude state can inherit that
#     and produce a false red indistinguishable from an auth failure.
#  2. A probe must not mutate the thing it observes. Writing session and
#     project state into the tenant's own HOME every 6 hours is a side
#     effect on live state, not a measurement of it.
#
# The credential is unaffected: it arrives via CLAUDE_CODE_OAUTH_TOKEN,
# which is the ONLY mechanism here (`claude setup-token` persists nothing),
# so a throwaway HOME still exercises the real auth path.
SPAWN_HOME="$(mktemp -d /tmp/a6-spawn-XXXXXX)"
chown "$OS_USER":"$OS_USER" "$SPAWN_HOME"
trap 'rm -rf "$SPAWN_HOME"' EXIT
OUT="$(cd / && runuser -u "$OS_USER" -- env HOME="$SPAWN_HOME" \
  CLAUDE_CODE_OAUTH_TOKEN="$CLAUDE_CODE_OAUTH_TOKEN" \
  "$CLAUDE_BIN" -p "Reply with exactly this token and nothing else: ${SENTINEL}" 2>&1)" || true

if echo "$OUT" | grep -q "$SENTINEL"; then
  echo "agent-probe: OK real spawn authenticated and answered for '${TENANT_ID}'"
  exit 0
fi
# Deliberately truncates and does not echo the whole output: a failing
# `claude` can print request context, and this string travels to syslog and
# on to Log Analytics.
fail "real spawn did not return the sentinel for '${TENANT_ID}' - token likely expired/revoked or quota exhausted. First 200 chars: $(echo "$OUT" | head -c 200)"
