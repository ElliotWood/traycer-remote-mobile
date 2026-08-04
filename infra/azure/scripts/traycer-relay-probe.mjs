// End-to-end probe for the tenant router (traycer-tenant-router.service).
// Exists because of a real outage that every other check called healthy.
//
// THE FAILURE THIS IS BUILT FOR
// The predecessor relay sent `ws://127.0.0.1:<port>` as the upstream Origin.
// The host enforces an HTTP loopback Origin and 403'd every single upstream
// connection, so epic loading was completely broken. Meanwhile:
//
//   systemctl is-active <the relay>       -> active
//   nginx -t / systemctl is-active nginx  -> green
//   browser WebSocket handshake           -> SUCCEEDS (101)
//   every A0 acceptance-test row          -> passed
//
// Nothing was wrong with any component's own liveness. The relay was up,
// listening, and accepting connections; it just could not pass a single byte
// through to the host. That is the hollow-green pattern this epic keeps
// finding, and a process-liveness check can never catch it.
//
// ─────────────────────────────────────────────────────────────────────────
// WHY THIS PROBE WAS REWRITTEN, AND WHAT IT USED TO ASSERT
//
// The original assertion was: connect with no credentials, hold the socket
// for a settle window, pass if it SURVIVES. Against the old ws-deflate relay
// that was sound - that relay dialled the host immediately on connection, so
// surviving the window really did prove the upstream leg worked, and the
// Origin-403 case failed it (relay closes 1011 as soon as the dial fails).
//
// The tenant router replaced that relay on the same port, and the assertion
// silently stopped meaning anything. The router does not dial upstream at
// all until it receives a valid `open` frame carrying a bearer it has
// VERIFIED with authn and resolved against the identity registry. An
// unauthenticated socket just sits in the router's open-frame wait, which
// defaults to 15,000 ms (TRAYCER_OPEN_FRAME_TIMEOUT_MS) - three times the
// 5,000 ms settle window. So "survives 5 s" became true with no identity
// registry, no tenant host running, and authn unreachable. It had degenerated
// into "is something accepting on 45080": the exact liveness check this file's
// own header says can never catch the outage it was written for.
//
// WHAT THIS PROBE ASSERTS NOW
// Send a DELIBERATELY MALFORMED first frame and require the router to REFUSE
// it with close code 1008, promptly. That is a behaviour only a running,
// parsing router produces:
//
//   nothing listening on the port      -> connect error            -> FAIL
//   something else listening           -> no 1008, or a hang       -> FAIL
//   router up, refusing correctly      -> 1008 within the window   -> PASS
//
// A frame the router merely IGNORED would leave the socket open and time out
// here, so passing requires it to have parsed the frame and acted on it.
//
// 🔴 WHAT THIS PROBE DOES NOT ASSERT, STATED PLAINLY. It does not prove a
// tenant's traffic reaches that tenant's host, because proving that needs a
// bearer authn will verify, and this probe holds no credentials and must not.
// The old probe's end-to-end reach is genuinely NOT replaced here - it was
// already gone the moment the router took the port, and this makes the loss
// visible rather than papering over it with a green. The end-to-end leg is
// covered by traycer-agent-spawn-probe, which does hold a real token. If you
// are looking for "can alice reach alice's host", that is the probe to read.
//
// Exit codes: 0 = healthy, 1 = probe failed (alertable), 2 = usage error.
import { WebSocket } from "ws";

const RELAY_URL = process.argv[2] ?? "ws://127.0.0.1:45080/rpc";
// Must stay well UNDER the router's open-frame timeout (15,000 ms default).
// If this ever exceeds it, the router's own timeout would close the socket
// first and the probe would pass on the router's giving-up rather than on its
// refusing - a green for the wrong reason, which is how this probe broke the
// first time.
const REFUSAL_MS = Number(process.argv[3] ?? 5000);

if (!Number.isFinite(REFUSAL_MS) || REFUSAL_MS <= 0) {
  console.error("usage: traycer-relay-probe.mjs [relayUrl] [refusalWindowMs]");
  process.exit(2);
}

/** The router's refusal code for a first frame that is not a valid `open`. */
const CLOSE_POLICY = 1008;

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

// Bounds the whole probe independently of any socket event, so a router that
// accepts a connection and then never speaks or closes (a hang, as opposed to
// a refusal) still resolves rather than pinning the timer unit open forever.
const hardTimeout = setTimeout(
  () => fail(`no verdict within ${REFUSAL_MS + 5000}ms - the router neither refused nor closed`),
  REFUSAL_MS + 5000,
);
hardTimeout.unref?.();

const ws = new WebSocket(RELAY_URL, { perMessageDeflate: true });

ws.on("open", () => {
  // Well-formed JSON, deliberately NOT an `open` frame. Chosen over raw
  // garbage so the router has to parse it and reject it on its CONTENT -
  // unparseable bytes could be refused by a much dumber process that happened
  // to hold the port, which would let this probe pass on something that is
  // not the router at all.
  ws.send(JSON.stringify({ kind: "not-an-open-frame", probe: "traycer-relay-probe" }));

  // No refusal inside the window is a failure. Note this fires only if the
  // close handler has not already settled the verdict.
  setTimeout(
    () => fail(`router did not refuse a malformed first frame within ${REFUSAL_MS}ms - it is listening but not routing`),
    REFUSAL_MS,
  ).unref?.();
});

ws.on("close", (code, reason) => {
  const detail = String(reason ?? "");
  if (code === CLOSE_POLICY) {
    pass(`router refused a malformed first frame with ${CLOSE_POLICY} ("${detail}") - it is parsing and refusing, not merely listening`);
  }
  // Anything else is a real finding. 1011 is what the router sends when a
  // correctly-routed tenant's host is unreachable - it should be impossible
  // here, since this frame never routes, so seeing it means the router is
  // dialling upstream on input it has not verified.
  if (code === 1011) {
    fail(`router closed 1011 on an UNVERIFIED frame - it should never reach an upstream dial without a verified bearer: ${detail}`);
  }
  fail(`router closed ${code} rather than ${CLOSE_POLICY} on a malformed first frame: ${detail}`);
});

ws.on("error", (err) => {
  fail(`could not reach the router at ${RELAY_URL}: ${String(err)}`);
});
