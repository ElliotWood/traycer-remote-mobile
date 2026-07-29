#!/bin/bash
set -euo pipefail
rm -f /usr/local/bin/traycer-relay-probe.mjs
cat > /usr/local/lib/traycer/traycer-relay-probe.mjs <<'PROBE_EOF'
// End-to-end probe for the WebSocket deflate relay
// (traycer-ws-deflate.service). Exists because of a real outage that every
// other check called healthy.
//
// THE FAILURE THIS IS BUILT FOR
// The relay sent `ws://127.0.0.1:<port>` as the upstream Origin. The host
// enforces an HTTP loopback Origin and 403'd every single upstream
// connection, so epic loading was completely broken. Meanwhile:
//
//   systemctl is-active traycer-ws-deflate  -> active
//   nginx -t / systemctl is-active nginx    -> green
//   browser WebSocket handshake             -> SUCCEEDS (101)
//   every A0 acceptance-test row            -> passed
//
// Nothing was wrong with any component's own liveness. The relay was up,
// listening, and accepting connections; it just could not pass a single
// byte through to the host. That is the hollow-green pattern this epic
// keeps finding, and a process-liveness check can never catch it.
//
// WHY THE HANDSHAKE SUCCEEDING IS THE TRAP
// Read traycer-ws-deflate-proxy.mjs's `wss.on("connection")`: the browser
// connection is ACCEPTED first, and only then does the relay dial the
// host. So an upstream 403 produces a successful 101 to the browser
// followed by a 1011 close a moment later. Any probe that stops at "did
// the handshake succeed" reports green on a totally broken path - which
// is exactly what happened.
//
// WHAT THIS PROBE ACTUALLY ASSERTS
// Connect through the relay, then require the connection to SURVIVE a
// settle window. The 403 case fails it (relay closes 1011 "upstream
// error" as soon as the upstream dial fails); a healthy path holds the
// socket open. No credentials needed - the failure is at the WebSocket
// upgrade layer, below protocol auth, so an unauthenticated connection
// exercises exactly the broken leg.
//
// Exit codes: 0 = healthy, 1 = probe failed (alertable), 2 = usage error.
import { WebSocket } from "ws";

const RELAY_URL = process.argv[2] ?? "ws://127.0.0.1:45080/rpc";
const SETTLE_MS = Number(process.argv[3] ?? 5000);

if (!Number.isFinite(SETTLE_MS) || SETTLE_MS <= 0) {
  console.error("usage: traycer-relay-probe.mjs [relayUrl] [settleMs]");
  process.exit(2);
}

let settled = false;
const fail = (reason) => {
  if (settled) return;
  settled = true;
  console.error(`relay-probe: FAIL ${reason}`);
  process.exit(1);
};
const pass = (detail) => {
  if (settled) return;
  settled = true;
  console.log(`relay-probe: OK ${detail}`);
  process.exit(0);
};

// Bounds the whole probe independently of any socket event, so a relay
// that accepts a connection and then never speaks or closes (a hang, as
// opposed to a refusal) still resolves rather than pinning the timer unit
// open forever.
const hardTimeout = setTimeout(
  () => fail(`no verdict within ${SETTLE_MS + 5000}ms - relay accepted nothing and refused nothing`),
  SETTLE_MS + 5000,
);
hardTimeout.unref?.();

const ws = new WebSocket(RELAY_URL, { perMessageDeflate: true });

ws.on("open", () => {
  // Deliberately NOT a pass yet. See the header: the broken case reaches
  // exactly this point too.
  setTimeout(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.close(1000, "probe complete");
      pass(`connection held open through the relay for ${SETTLE_MS}ms`);
    } else {
      fail(`connection did not survive the ${SETTLE_MS}ms settle window (readyState=${ws.readyState})`);
    }
  }, SETTLE_MS).unref?.();
});

ws.on("close", (code, reason) => {
  // 1011 is precisely what the relay sends when its upstream dial fails -
  // the 403 signature. Any close inside the settle window is a failure,
  // but naming this one makes the alert actionable rather than generic.
  const detail = String(reason ?? "");
  if (code === 1011) {
    fail(`relay closed 1011 (upstream unreachable/refused - the Origin-403 signature): ${detail}`);
  }
  fail(`relay closed ${code} before the settle window elapsed: ${detail}`);
});

ws.on("error", (err) => {
  fail(`could not reach the relay at ${RELAY_URL}: ${String(err)}`);
});

PROBE_EOF
cat > /etc/systemd/system/traycer-relay-probe.service <<'SVC_EOF'
[Unit]
Description=A6 end-to-end probe for the WebSocket deflate relay
# NOT instanced per tenant (unlike traycer-health-probe@): the relay is a
# single shared process fronting the host, so one probe covers it.

[Service]
Type=oneshot
Environment=TRAYCER_HOME_ROOT=__TRAYCER_HOME_ROOT__
# `||` rather than letting a nonzero exit mark the unit failed: this probe
# is the thing that DETECTS a fault, so its own failure must become an
# alert, not a second failed unit for someone to notice separately.
# Lives in /usr/local/lib/traycer, NOT /usr/local/bin: it imports `ws`, and
# Node resolves bare specifiers by walking up from the SCRIPT's directory.
# The only node_modules/ws on this box is /usr/local/lib/traycer/node_modules
# (installed for the relay itself), so a copy in /usr/local/bin fails with
# ERR_MODULE_NOT_FOUND - found by running it there first, not predicted.
ExecStart=/bin/bash -c '/usr/bin/node /usr/local/lib/traycer/traycer-relay-probe.mjs || /usr/local/bin/traycer-alert.sh relay relay_unreachable "end-to-end relay probe failed - see journalctl -u traycer-relay-probe"'

SVC_EOF
cat > /etc/systemd/system/traycer-relay-probe.timer <<'TMR_EOF'
[Unit]
Description=A6 end-to-end relay probe timer

[Timer]
OnBootSec=90s
OnUnitActiveSec=120s
AccuracySec=10s

[Install]
WantedBy=timers.target

TMR_EOF
sed -i "s|__TRAYCER_HOME_ROOT__|/srv/traycer/tenants|g" /etc/systemd/system/traycer-relay-probe.service
systemctl daemon-reload
echo "=== POSITIVE TEST: healthy relay ==="
node /usr/local/lib/traycer/traycer-relay-probe.mjs ws://127.0.0.1:45080/rpc 4000; echo "exit=$?"