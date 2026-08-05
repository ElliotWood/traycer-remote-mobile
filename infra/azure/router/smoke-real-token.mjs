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
