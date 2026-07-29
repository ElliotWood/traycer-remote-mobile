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
# it watches for. So `--spawn` exists, is proven to work, and is NOT on a
# timer by default. Enabling it is a deliberate, documented quota
# decision, not something this script makes on the operator's behalf.
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

# 2. Credential must be AUTH-BEARING, not merely present.
#
#    An earlier draft of this checked `[ -s ~/.claude.json ]` and passed on
#    the live VM while `claude -p` returned "Not logged in - Please run
#    /login". `.claude.json` is first-run scaffolding that Claude Code
#    writes on startup whether or not anyone has authenticated: on this box
#    it existed, was 0600, was 389 bytes, parsed cleanly, and contained
#    ONLY telemetry and migration keys (machineID, userID,
#    cachedExperimentData, migrationVersion...) with no token of any kind.
#    So the file-exists check was itself a false-green for the one
#    condition that matters. Caught by running --spawn, not by reading the
#    code.
#
#    So: look for an actual credential. Never prints or logs any value -
#    key presence and file existence only, so this can never leak a token
#    into the journal or Log Analytics.
#
#    COUPLED TO CLAUDE CODE'S ON-DISK LAYOUT (~/.claude/.credentials.json,
#    or an oauth/token key inside ~/.claude.json). That is an internal
#    detail and may change between versions - if this starts failing on a
#    box that genuinely works, check the layout before trusting the alert.
CRED_JSON="${TENANT_HOME}/.claude.json"
CRED_FILE="${TENANT_HOME}/.claude/.credentials.json"
if [ ! -s "$CRED_FILE" ]; then
  if ! { [ -s "$CRED_JSON" ] && grep -qE '"(oauthAccount|accessToken|refreshToken|primaryApiKey)"' "$CRED_JSON"; }; then
    fail "no Claude credential for '${TENANT_ID}': neither ${CRED_FILE} nor an auth key in ${CRED_JSON}. Agents cannot authenticate - someone must run 'claude' interactively as ${OS_USER} with HOME=${TENANT_HOME} and complete /login. NOTE: ${CRED_JSON} existing is NOT evidence of login; it is written on first run regardless."
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
  echo "agent-probe: OK structural checks passed for '${TENANT_ID}' (binary, credential, repo git). Credential LIVENESS not proven - run with --spawn for that, at quota cost."
  exit 0
fi

# 4. Real spawn. Asserts on a SENTINEL in the output, never on exit code
#    alone: `claude` can exit 0 having produced an error message, and this
#    project has already been burned by a probe that read output it did not
#    own. A marker the prompt itself demands is the only proof the model
#    actually answered.
SENTINEL="A6PROBE$(date -u +%s)"
OUT="$(cd / && runuser -u "$OS_USER" -- env HOME="$TENANT_HOME" \
  "$CLAUDE_BIN" -p "Reply with exactly this token and nothing else: ${SENTINEL}" 2>&1)" || true

if echo "$OUT" | grep -q "$SENTINEL"; then
  echo "agent-probe: OK real spawn authenticated and answered for '${TENANT_ID}'"
  exit 0
fi
fail "real spawn did not return the sentinel for '${TENANT_ID}' - credential likely expired/revoked or quota exhausted. First 200 chars: $(echo "$OUT" | head -c 200)"
