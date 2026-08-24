#!/usr/bin/env bash
# Mutation-tests the A6 relay probe against a REAL tenant-router process.
#
# WHY THIS EXISTS. The probe it tests was, until this commit, passing against
# a service it could not actually check - it asserted "an unauthenticated
# socket survives 5 s", which the router leaves true for 15 s whether or not
# it has a registry, a tenant host, or a reachable authn. Nobody noticed
# because the probe was green, and a probe nobody has watched FAIL is a probe
# nobody has checked. So the rewrite ships with the failure demonstrated, in
# both directions, rather than asserted.
#
# THE THREE CASES, and the third is the one that matters:
#
#   1. router up               -> PASS   (exit 0)
#   2. router stopped          -> FAIL   (exit 1)   - the obvious mutation
#   3. a dumb WebSocket server -> FAIL   (exit 1)   - accepts the connection
#      that accepts and ignores               and ignores the frame, i.e.
#                                              exactly what "is something
#                                              listening on 45080" looks
#                                              like. The OLD probe passed
#                                              this case. If a future edit
#                                              makes it pass again, the probe
#                                              has regressed to a port check.
#
# Case 3 is the whole point: cases 1 and 2 together are satisfied by any
# liveness check, so on their own they would not have caught the defect this
# rewrite fixes.
#
# Everything is synthetic - a made-up tenant id, a made-up user id, a home
# directory under the temp dir, and an authn base URL pointing at a port
# nothing listens on. The malformed-frame refusal happens BEFORE the router
# ever calls authn, so an unreachable authn does not affect the result; that
# it doesn't is itself asserted by case 1 passing.
#
# Usage: infra/azure/scripts/verify-relay-probe.sh
# Requires: node, npm (fetches ws + zod into a temp dir).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
ROUTER="${REPO_ROOT}/infra/azure/router/tenant-router.generated.mjs"
PROBE="${REPO_ROOT}/infra/azure/scripts/traycer-relay-probe.mjs"
PORT="${TRAYCER_PROBE_TEST_PORT:-45081}"
WORK="$(mktemp -d)"
ROUTER_PID=""
DUMB_PID=""

cleanup() {
  if [ -n "$ROUTER_PID" ]; then kill "$ROUTER_PID" 2>/dev/null || true; fi
  if [ -n "$DUMB_PID" ]; then kill "$DUMB_PID" 2>/dev/null || true; fi
  rm -rf "$WORK"
}
trap cleanup EXIT

fail() { echo "verify-relay-probe: FAIL - $1" >&2; exit 1; }

[ -f "$ROUTER" ] || fail "router bundle not found at ${ROUTER} - run infra/azure/router/build.sh"
[ -f "$PROBE" ] || fail "probe not found at ${PROBE}"

echo "verify-relay-probe: installing ws + zod into a temp dir"
cp "$ROUTER" "$WORK/tenant-router.mjs"
cp "$PROBE" "$WORK/traycer-relay-probe.mjs"
( cd "$WORK" && npm install --no-save --no-audit --no-fund --loglevel=error ws zod >/dev/null 2>&1 ) || \
  fail "npm install ws zod failed - this test needs network access"

# Synthetic registry. The tenant's home must exist for the router to accept
# the registry, but nothing under it is ever read on the refusal path.
mkdir -p "$WORK/tenants/probe-tenant"
cat > "$WORK/registry.json" <<EOF
{
  "tenants": [
    { "home": "${WORK}/tenants/probe-tenant", "hostId": "probe-tenant", "traycerUserId": "synthetic-user-id-for-tests" }
  ]
}
EOF

wait_for_port() {
  for _ in $(seq 1 50); do
    if node -e '
      const net=require("net");const s=net.connect(Number(process.argv[1]),"127.0.0.1");
      s.on("connect",()=>{s.destroy();process.exit(0)});s.on("error",()=>process.exit(1));
    ' "$1" 2>/dev/null; then return 0; fi
    sleep 0.2
  done
  return 1
}

run_case() { # run_case <label> <expected: pass|fail>
  local label="$1" expected="$2" rc=0
  node "$WORK/traycer-relay-probe.mjs" "ws://127.0.0.1:${PORT}/rpc" 3000 >"$WORK/out.txt" 2>&1 || rc=$?
  local got="pass"; [ "$rc" -ne 0 ] && got="fail"
  printf '  %-34s expected %-4s got %-4s (exit %s)\n' "$label" "$expected" "$got" "$rc"
  sed 's/^/      /' "$WORK/out.txt"
  [ "$got" = "$expected" ] || fail "${label}: expected the probe to ${expected}, it ${got}ed"
}

echo "verify-relay-probe: case 1 - router running"
TRAYCER_AUTHN_BASE_URL="http://127.0.0.1:1" \
  node "$WORK/tenant-router.mjs" "$PORT" "$WORK/registry.json" >"$WORK/router.log" 2>&1 &
ROUTER_PID=$!
wait_for_port "$PORT" || { cat "$WORK/router.log" >&2; fail "router did not start listening on ${PORT}"; }
run_case "router up" pass

echo "verify-relay-probe: case 2 - router stopped"
kill "$ROUTER_PID" 2>/dev/null || true
wait "$ROUTER_PID" 2>/dev/null || true
ROUTER_PID=""
run_case "router stopped" fail

echo "verify-relay-probe: case 3 - a listener that accepts and ignores"
# The mutation that matters. This is what the port looks like to a liveness
# check, and what the previous version of the probe reported as healthy.
cat > "$WORK/dumb.mjs" <<'DUMB_EOF'
import { WebSocketServer } from "ws";
const port = Number(process.argv[2]);
if (!Number.isInteger(port)) { console.error(`dumb listener: bad port ${process.argv[2]}`); process.exit(2); }
const wss = new WebSocketServer({ port, host: "127.0.0.1" });
// Accept every connection, read every frame, answer nothing, close nothing.
wss.on("connection", (ws) => ws.on("message", () => {}));
DUMB_EOF
node "$WORK/dumb.mjs" "$PORT" >"$WORK/dumb.log" 2>&1 &
DUMB_PID=$!
wait_for_port "$PORT" || { cat "$WORK/dumb.log" >&2; fail "the dumb listener did not start on ${PORT}"; }
run_case "accepts and ignores" fail

echo "verify-relay-probe: PASS - 3/3 cases, including the liveness-only listener the old probe called healthy"
