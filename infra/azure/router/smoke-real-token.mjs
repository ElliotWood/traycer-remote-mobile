#!/usr/bin/env node
// Operational smoke test: drives a REAL tenant's REAL Traycer token through
// the router against the REAL production authn service and the REAL host.
//
// The routing harness (`verify-routing.mjs`) proves the routing DECISION with
// synthetic tenants and a stand-in authn. This proves the other half — that
// the decision is being made from a genuine production credential, that
// authn.traycer.ai actually answers for it, and that the tenant's real host
// accepts what comes out the far side. Neither test subsumes the other.
//
// Never prints the token, and prints only a short fingerprint of the user id
// (this output ends up in operator logs and agent transcripts).
//
// Usage: node smoke-real-token.mjs <router-port|ws-url> <tenant-credentials-path>
//
// Accepts either a bare loopback port (tests the router directly) or a full
// ws/wss URL (tests the whole public chain: TLS -> nginx -> router -> host).
// Both are worth running: the first isolates the router, the second is what a
// real browser actually traverses.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { WebSocket } from "ws";

const [, , portArg, credsPath] = process.argv;
if (!portArg || !credsPath) {
  console.error("usage: node smoke-real-token.mjs <router-port|ws-url> <credentials-path>");
  process.exit(2);
}
const target = /^wss?:\/\//.test(portArg) ? portArg : `ws://127.0.0.1:${portArg}/rpc`;

const creds = JSON.parse(readFileSync(credsPath, "utf8"));
const token = creds?.token;
const userId = creds?.user?.id;
if (typeof token !== "string" || token.length === 0) {
  console.error("smoke: credentials file has no usable token");
  process.exit(2);
}
const fingerprint = createHash("sha256").update(String(userId)).digest("hex").slice(0, 12);
console.log(`smoke: using real credentials for user sha256=${fingerprint} (token not shown)`);

/**
 * Expiry pre-check, and it exists because of a real misdiagnosis.
 *
 * This harness reads a token from a file on disk. Nothing refreshes that file
 * on a schedule, so it goes stale. When it does, the router correctly refuses
 * the connection — and this script used to report that as
 * `FAIL routing or authn refused it`, which reads as a routing defect and
 * cost a diagnosis cycle chasing an nginx change that was provably unrelated.
 *
 * A test must not report someone else's component as broken when its own
 * input is invalid. Reading `exp` without verifying the signature is
 * legitimate here for exactly the reason `clients/shared/auth/jwt-exp.ts`
 * gives: this is scheduling/diagnostic use, not an identity decision. Nothing
 * downstream trusts it.
 */
const expSeconds = (() => {
  const seg = String(token).split(".")[1];
  if (seg === undefined) return null;
  try {
    const b64 = seg.replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
    return typeof payload.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
})();
if (expSeconds !== null) {
  const secondsLeft = expSeconds - Math.floor(Date.now() / 1000);
  if (secondsLeft <= 0) {
    console.log(
      `SKIP  the stored credential expired ${String(-secondsLeft)}s ago — this says nothing about routing.\n` +
        `      Refresh it (sign in again on this machine, or let a host/CLI rotate it) and re-run.\n` +
        `      Deliberately exit 2, NOT 1: a stale input is an inconclusive run, not a failure of the thing under test.`,
    );
    process.exit(2);
  }
  console.log(`smoke: credential valid for a further ${String(secondsLeft)}s`);
}

console.log(`smoke: connecting to ${target}`);
// permessage-deflate is the relay's original reason for existing; asking for
// it here means a successful run also confirms it survived the rewrite.
const ws = new WebSocket(target, { perMessageDeflate: true });
let settled = false;
const done = (ok, msg) => {
  if (settled) return;
  settled = true;
  console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`);
  try { ws.close(); } catch { /* already closing */ }
  process.exit(ok ? 0 : 1);
};

ws.on("open", () => {
  // A minimal open frame. The host will reject it on manifest grounds if the
  // manifest is wrong, but that rejection still proves the connection was
  // ROUTED to a real host and got a protocol-level answer — which is what
  // this test is asserting. A routing failure closes before any host reply.
  ws.send(JSON.stringify({ kind: "open", token, manifest: {} }));
});

ws.on("message", (data) => {
  const text = data.toString().slice(0, 220);
  // Any host-originated frame means the router picked a tenant, dialled that
  // tenant's host, and the host answered.
  const deflate = ws.extensions?.includes("permessage-deflate") ? "yes" : "no";
  done(true, `routed to a live host (permessage-deflate=${deflate}); host replied: ${text}`);
});

ws.on("close", (code, reason) => {
  done(
    false,
    `connection closed before any host reply (code=${code} reason=${reason.toString()}) — routing or authn refused it`,
  );
});

ws.on("error", (err) => done(false, `socket error: ${err.message}`));

setTimeout(() => done(false, "timed out with no host reply"), 20000);
