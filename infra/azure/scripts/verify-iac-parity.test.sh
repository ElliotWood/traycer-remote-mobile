#!/usr/bin/env bash
# Mutation-tests the drift check itself. No Azure, no VM, no network.
#
# THE FIRST CASE IS THE ONE THE CHECK EXISTS FOR, deliberately, rather than
# the last: repoint `traycer_host` from the tenant router to one tenant's
# host, and the check must go RED - even though `nginx -t` stays green, the
# site keeps serving, and every other check on this box stays green too. A
# drift check that cannot demonstrate that on demand is a drift check nobody
# has watched fail.
#
# HOW THE FIXTURES ARE BUILT, and why it is done this way. The "actual"
# documents are the REAL derived expected state with one field mutated. That
# makes each case a genuine single-variable experiment: the only difference
# between the green control and a red case is the mutation, so a red result
# cannot be coming from an unrelated mismatch in the fixture.
#
# 🔴 THE LIMIT OF THIS FILE, STATED RATHER THAN IMPLIED. Because the actual
# side here is derived from the expected side, these cases prove that the
# COMPARISON discriminates. They prove nothing about whether
# collect-vm-state.sh reads a real machine correctly - that half is exercised
# only by running it against a VM. Do not read a green here as "the drift
# check works end to end"; read it as "the comparison can tell these ten
# situations apart".
#
# Usage: infra/azure/scripts/verify-iac-parity.test.sh
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SCRIPTS="${REPO_ROOT}/infra/azure/scripts"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

PASSED=0
FAILED=0

# The expected side, derived once. Synthetic parameters throughout - a real
# hostname or tenant name in a repo file is an OSS-hygiene violation, and the
# comparison does not depend on their values.
node "${SCRIPTS}/derive-expected-state.mjs" \
  --hostname host.example.com --email ops@example.com --tenants alice,bob \
  > "$WORK/expected.json" || { echo "verify-iac-parity.test: could not derive the expected state" >&2; exit 2; }

# `jq` is not assumed present; node is already a hard requirement here.
mutate() { # mutate <out> <js body operating on `s`>
  node -e '
    const fs = require("fs");
    const s = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    (new Function("s", process.argv[3]))(s);
    fs.writeFileSync(process.argv[2], JSON.stringify(s, null, 2));
  ' "$WORK/expected.json" "$1" "$2"
}

# The collector reports two fields the deriver does not, so a document that is
# otherwise the expected state still has to carry them or the control would go
# red for a reason that is not the mutation.
as_actual() { mutate "$1" "s.nginx.configReadable = true; s.listening = { '127.0.0.1:45080': { pid: '1234', unit: 'traycer-tenant-router.service' } }; ${2:-}"; }

check() { # check <label> <expected: pass|fail> <actual.json> [must-mention]
  local label="$1" want="$2" doc="$3" mention="${4:-}" rc=0 out
  out="$(node "${SCRIPTS}/compare-vm-state.mjs" "$WORK/expected.json" "$doc" 2>&1)" || rc=$?
  local got="pass"; [ "$rc" -ne 0 ] && got="fail"
  if [ "$got" != "$want" ]; then
    printf '  ✗ %-46s expected %s, got %s\n' "$label" "$want" "$got"
    printf '%s\n' "$out" | sed 's/^/        /'
    FAILED=$((FAILED + 1))
    return
  fi
  # A red result for the WRONG reason is not a pass. Requiring the finding to
  # name the thing that was mutated is what stops a fixture typo from being
  # read as the check working.
  if [ -n "$mention" ] && ! printf '%s' "$out" | grep -q "$mention"; then
    printf '  ✗ %-46s went %s but never mentioned %s\n' "$label" "$got" "$mention"
    printf '%s\n' "$out" | sed 's/^/        /'
    FAILED=$((FAILED + 1))
    return
  fi
  printf '  ✓ %-46s %s\n' "$label" "$want"
  PASSED=$((PASSED + 1))
}

echo "verify-iac-parity.test: the acceptance case first"

# ── 1. THE ACCEPTANCE CASE ───────────────────────────────────────────────
# 36705 is a real observed ephemeral host port from this epic's own notes -
# the exact value the superseded nginx-upstream watcher would have written in.
as_actual "$WORK/repointed.json" "s.nginx.upstreams.traycer_host = ['127.0.0.1:36705']; s.listening = { '127.0.0.1:36705': { pid: '4321', unit: 'traycer-host@alice.service' } };"
check "upstream repointed router -> tenant host" fail "$WORK/repointed.json" "UPSTREAM-REPOINTED"

# The same mutation, with the file left alone and only the RESOLVED target
# changed, is what a config edited-but-not-reloaded looks like from a config
# dump. Same finding, so the check does not depend on the two agreeing.
as_actual "$WORK/repointed-dead.json" "s.nginx.upstreams.traycer_host = ['127.0.0.1:36705'];"
check "repointed, nothing listening on the new port" fail "$WORK/repointed-dead.json" "UPSTREAM-REPOINTED"

# The acceptance case's nastiest variant: the CONFIG is untouched and correct,
# so nginx -T, the upstream file's hash and the location set all agree with
# the template - but a different unit holds the port. The superseded
# ws-deflate relay taking 45080 is exactly this, and it is invisible to every
# other check here. It is also the case a process-NAME comparison could never
# catch, because both processes are `node`.
as_actual "$WORK/impostor.json" "s.listening = { '127.0.0.1:45080': { pid: '9999', unit: 'traycer-ws-deflate.service' } };"
check "right port, wrong unit holding it" fail "$WORK/impostor.json" "UPSTREAM-IMPOSTOR"

# And the inverse - nothing at all on the port - must be a DIFFERENT finding,
# not the same one. Conflating "down" with "wrong process" would send someone
# to restart a service that is already running.
as_actual "$WORK/dead.json" "s.listening = { '127.0.0.1:22': { pid: '1', unit: 'ssh.service' } };"
check "nothing listening on the upstream's port" fail "$WORK/dead.json" "UPSTREAM-DEAD"

echo "verify-iac-parity.test: the control - this must be the only green"
as_actual "$WORK/clean.json"
check "unmutated VM state" pass "$WORK/clean.json"

echo "verify-iac-parity.test: every other direction, one field at a time"

# ── files, all three directions ──────────────────────────────────────────
as_actual "$WORK/f-missing.json" "delete s.files['/usr/local/lib/traycer/tenant-router.mjs'];"
check "a deployed file absent from the VM" fail "$WORK/f-missing.json" "MISSING"

as_actual "$WORK/f-diff.json" "s.files['/usr/local/lib/traycer/tenant-router.mjs'] = '0'.repeat(64);"
check "a deployed file edited in place" fail "$WORK/f-diff.json" "DIFFERENT"

# The direction this epic keeps getting caught by: something real, running,
# and in nobody's IaC. Named after the actual file that was in exactly this
# state on the live VM for a week.
as_actual "$WORK/f-extra.json" "s.files['/usr/local/lib/traycer/traycer-ws-deflate-proxy.mjs'] = '1'.repeat(64);"
check "a file on the VM and in no template" fail "$WORK/f-extra.json" "UNEXPECTED"

# ── units ────────────────────────────────────────────────────────────────
as_actual "$WORK/u-off.json" "delete s.enabledUnits['traycer-tenant-router.service'];"
check "the router not enabled" fail "$WORK/u-off.json" "UNIT-NOT-ENABLED"

as_actual "$WORK/u-runtime.json" "s.enabledUnits['traycer-tenant-router.service'] = 'enabled-runtime';"
check "enabled-runtime, i.e. lost on reboot" fail "$WORK/u-runtime.json" "UNIT-STATE"

# The regression the ticket names explicitly: enabling the superseded watcher
# silently reverts the box to single-tenant.
as_actual "$WORK/u-extra.json" "s.enabledUnits['traycer-nginx-upstream@alice.path'] = 'enabled';"
check "the superseded upstream watcher re-enabled" fail "$WORK/u-extra.json" "UNIT-UNEXPECTED"

# ── nginx routes and seams ───────────────────────────────────────────────
as_actual "$WORK/n-loc.json" "s.nginx.locations = s.nginx.locations.filter(l => l !== '/rpc');"
check "a vhost location gone" fail "$WORK/n-loc.json" "LOCATIONS"

# An include whose glob matches zero files is valid nginx and contributes
# nothing, so a REMOVED include and an empty drop-in directory look identical
# from every other angle - including a green `nginx -t`. This is the only
# thing that can tell them apart.
as_actual "$WORK/n-inc.json" "s.nginx.includes = s.nginx.includes.filter(i => !i.includes('traycer-locations.d'));"
check "the drop-in include seam gone" fail "$WORK/n-inc.json" "INCLUDES"

# ── the collector failing must not read as parity ────────────────────────
as_actual "$WORK/c-unreadable.json" "s.nginx.configReadable = false;"
check "collector could not read nginx config" fail "$WORK/c-unreadable.json" "COLLECTOR"

# ── the deriver failing must not read as parity either ───────────────────
node -e '
  const fs=require("fs");const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
  s.files={}; fs.writeFileSync(process.argv[2], JSON.stringify(s,null,2));
' "$WORK/expected.json" "$WORK/empty-expected.json"
rc=0
out="$(node "${SCRIPTS}/compare-vm-state.mjs" "$WORK/empty-expected.json" "$WORK/clean.json" 2>&1)" || rc=$?
if [ "$rc" -eq 2 ]; then
  printf '  ✓ %-46s refuses (exit 2)\n' "an expected side that derived nothing"
  PASSED=$((PASSED + 1))
else
  printf '  ✗ %-46s expected exit 2, got %s\n' "an expected side that derived nothing" "$rc"
  printf '%s\n' "$out" | sed 's/^/        /'
  FAILED=$((FAILED + 1))
fi

echo
echo "verify-iac-parity.test: ${PASSED} passed, ${FAILED} failed"
[ "$FAILED" -eq 0 ] || exit 1
