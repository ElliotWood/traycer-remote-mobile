#!/usr/bin/env node
// Executable proof that the tenant router actually routes — run against the
// BUILT ARTIFACT, not the TypeScript source, so what is verified is what
// deploys.
//
// A config that looks right is not evidence. This stands up two real host
// listeners on two different ports, two real tenant homes with their own
// pid.json, a real authn service, and the real bundled router; then drives
// real WebSocket connections through it and asserts which listener each one
// physically arrived at.
//
// The cases that matter, and why each is here:
//   1. identity A -> host A                  (routing works at all)
//   2. identity B -> host B, NOT host A      (kills "always the first tenant",
//                                             which every single-tenant test
//                                             in the world would pass)
//   3. verified but unmapped identity        -> refused, no host reached
//   4. token authn rejects                   -> refused, no host reached
//   5. authn unreachable                     -> refused (fails CLOSED, does not
//                                             fall back to a default tenant)
//   6. upstream Origin is http://, not ws:// (regression guard: a ws:// Origin
//                                             made the host 403 every
//                                             connection and cost a live outage)
//
// Usage: node verify-routing.mjs <path-to-bundled-tenant-router.mjs>
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocketServer, WebSocket } from "ws";

const ROUTER = process.argv[2];
if (!ROUTER) {
  console.error("usage: node verify-routing.mjs <bundled-router.mjs>");
  process.exit(2);
}

const TOKEN_A = "token-for-tenant-a";
const TOKEN_B = "token-for-tenant-b";
const TOKEN_UNMAPPED = "token-for-a-real-but-unregistered-user";
const TOKEN_BAD = "token-authn-will-reject";
const USER_A = "traycer-user-aaaa-1111";
const USER_B = "traycer-user-bbbb-2222";
const USER_UNMAPPED = "traycer-user-cccc-3333";

const cleanups = [];
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

function listen(server, port = 0) {
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => resolve(server.address().port));
  });
}

/** A stand-in Traycer authn: maps a presented bearer to a user id, or rejects it. */
async function startAuthn() {
  const tokens = new Map([
    [TOKEN_A, USER_A],
    [TOKEN_B, USER_B],
    [TOKEN_UNMAPPED, USER_UNMAPPED],
  ]);
  const server = createServer((req, res) => {
    const auth = req.headers.authorization ?? "";
    const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const userId = tokens.get(bearer);
    res.setHeader("content-type", "application/json");
    if (!userId) {
      res.statusCode = 401;
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    res.statusCode = 200;
    res.end(JSON.stringify({ user: { id: userId, email: "", name: userId } }));
  });
  const port = await listen(server);
  cleanups.push(() => server.close());
  return `http://127.0.0.1:${port}`;
}

/** A stand-in Traycer host: records every connection it receives, with the Origin header it saw. */
async function startHost(label) {
  const received = [];
  const server = createServer();
  const wss = new WebSocketServer({ server });
  wss.on("connection", (ws, req) => {
    const entry = { origin: req.headers.origin ?? null, path: req.url, frames: [] };
    received.push(entry);
    ws.on("message", (data) => {
      entry.frames.push(data.toString());
      // Mimic the host's openAck so the client side completes normally.
      ws.send(JSON.stringify({ kind: "openAck", from: label }));
    });
  });
  const port = await listen(server);
  cleanups.push(() => {
    wss.close();
    server.close();
  });
  return { label, port, received };
}

function tenantHome(label, port) {
  const home = mkdtempSync(join(tmpdir(), `tenant-${label}-`));
  mkdirSync(join(home, ".traycer", "host"), { recursive: true });
  writeFileSync(
    join(home, ".traycer", "host", "pid.json"),
    JSON.stringify({
      pid: 1,
      hostId: `hostid-${label}`,
      version: "1.1.8",
      websocketUrl: `ws://127.0.0.1:${port}/rpc`,
      startedAt: new Date(0).toISOString(),
    }),
  );
  cleanups.push(() => rmSync(home, { recursive: true, force: true }));
  return home;
}

/**
 * Opens a connection to the router, sends an open frame carrying `token`, and
 * reports what happened: did it get a reply (routed), or was it closed?
 */
function attempt(routerPort, token) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${routerPort}/rpc`);
    let settled = false;
    const done = (outcome) => {
      if (settled) return;
      settled = true;
      try { ws.close(); } catch { /* already closing */ }
      resolve(outcome);
    };
    ws.on("open", () => {
      ws.send(JSON.stringify({ kind: "open", token, manifest: {} }));
    });
    ws.on("message", (data) => done({ kind: "routed", reply: data.toString() }));
    ws.on("close", (code) => done({ kind: "closed", code }));
    ws.on("error", () => done({ kind: "closed", code: 0 }));
    setTimeout(() => done({ kind: "timeout" }), 8000);
  });
}

async function startRouter(registryPath, authnBaseUrl) {
  const port = 45999;
  const child = spawn(process.execPath, [ROUTER, String(port), registryPath], {
    env: { ...process.env, TRAYCER_AUTHN_BASE_URL: authnBaseUrl },
    stdio: ["ignore", "inherit", "pipe"],
  });
  const log = [];
  child.stderr.on("data", (d) => log.push(d.toString()));
  cleanups.push(() => child.kill("SIGKILL"));
  // Wait for the listening line rather than sleeping a guessed interval.
  await new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error(`router did not start:\n${log.join("")}`)), 10000);
    const poll = setInterval(() => {
      if (log.join("").includes("listening on")) {
        clearTimeout(deadline);
        clearInterval(poll);
        resolve();
      }
      if (child.exitCode !== null) {
        clearTimeout(deadline);
        clearInterval(poll);
        reject(new Error(`router exited ${child.exitCode}:\n${log.join("")}`));
      }
    }, 100);
  });
  return { port, log };
}

async function main() {
  const authnBaseUrl = await startAuthn();
  const hostA = await startHost("A");
  const hostB = await startHost("B");
  const homeA = tenantHome("a", hostA.port);
  const homeB = tenantHome("b", hostB.port);

  const registryPath = join(mkdtempSync(join(tmpdir(), "registry-")), "identity-registry.json");
  writeFileSync(
    registryPath,
    JSON.stringify({
      tenants: [
        { home: homeA, hostId: "tenant-a", traycerUserId: USER_A },
        { home: homeB, hostId: "tenant-b", traycerUserId: USER_B },
      ],
    }),
  );

  const router = await startRouter(registryPath, authnBaseUrl);

  // 1 + 2: the two-identity requirement. Distinct identities, distinct hosts.
  const a = await attempt(router.port, TOKEN_A);
  check("identity A is routed", a.kind === "routed", `outcome=${a.kind}`);
  check(
    "identity A physically reached host A",
    hostA.received.length === 1 && hostB.received.length === 0,
    `hostA=${hostA.received.length} hostB=${hostB.received.length}`,
  );

  const b = await attempt(router.port, TOKEN_B);
  check("identity B is routed", b.kind === "routed", `outcome=${b.kind}`);
  check(
    "identity B physically reached host B, NOT host A (kills always-first-tenant)",
    hostB.received.length === 1 && hostA.received.length === 1,
    `hostA=${hostA.received.length} hostB=${hostB.received.length}`,
  );

  // The open frame must reach the host verbatim — the host does its own token
  // validation on it, so the router reading it must not consume it.
  const forwarded = hostA.received[0]?.frames[0] ?? "";
  check(
    "the open frame is forwarded to the host verbatim",
    forwarded.includes(TOKEN_A) && forwarded.includes('"kind":"open"'),
    forwarded.slice(0, 80),
  );

  // 6: the regression that caused a live outage.
  check(
    "upstream Origin is http:// not ws:// (outage regression guard)",
    hostA.received[0]?.origin === `http://127.0.0.1:${hostA.port}`,
    `origin=${hostA.received[0]?.origin}`,
  );

  // 3: authentic, but nobody's tenant.
  const beforeUnmapped = hostA.received.length + hostB.received.length;
  const unmapped = await attempt(router.port, TOKEN_UNMAPPED);
  check("verified-but-unmapped identity is refused", unmapped.kind === "closed", `outcome=${unmapped.kind}`);
  check(
    "unmapped identity reached NO host",
    hostA.received.length + hostB.received.length === beforeUnmapped,
    `total=${hostA.received.length + hostB.received.length}`,
  );

  // 4: authn says no.
  const beforeBad = hostA.received.length + hostB.received.length;
  const bad = await attempt(router.port, TOKEN_BAD);
  check("token rejected by authn is refused", bad.kind === "closed", `outcome=${bad.kind}`);
  check(
    "rejected token reached NO host",
    hostA.received.length + hostB.received.length === beforeBad,
    `total=${hostA.received.length + hostB.received.length}`,
  );

  // 5: fail closed when the identity provider is unreachable, rather than
  // falling back to any tenant.
  for (const c of cleanups.splice(0, 1)) c(); // stop authn only
  const beforeDown = hostA.received.length + hostB.received.length;
  const authnDown = await attempt(router.port, TOKEN_A);
  check(
    "authn unreachable -> refused, NOT routed to a default tenant",
    authnDown.kind === "closed",
    `outcome=${authnDown.kind}`,
  );
  check(
    "with authn down, NO host was reached",
    hostA.received.length + hostB.received.length === beforeDown,
    `total=${hostA.received.length + hostB.received.length}`,
  );

  console.log("\n--- router stderr ---");
  process.stdout.write(router.log.join(""));
}

main()
  .catch((err) => {
    console.error(`HARNESS ERROR: ${err.stack ?? err}`);
    check("harness completed", false, String(err));
  })
  .finally(() => {
    for (const c of cleanups) {
      try { c(); } catch { /* best effort */ }
    }
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
    process.exit(failed.length === 0 ? 0 : 1);
  });
