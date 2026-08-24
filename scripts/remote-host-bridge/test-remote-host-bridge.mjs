#!/usr/bin/env node
// Self-test for the loopback bridge. Stands up a fake "remote host" on
// loopback, points the bridge at it, and asserts the things the desktop
// actually depends on: the published pid.json shape, the loopback endpoint
// contract, path preservation through the upgrade, the Host/Origin rewrite,
// retraction on exit, and the production-slot guard.
//
// Deliberately needs no network and no real remote host, so it is runnable
// on any machine at any time:  node test-remote-host-bridge.mjs

import net from "node:net";
import { spawn } from "node:child_process";
import { readFileSync, rmSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BRIDGE = join(HERE, "remote-host-bridge.mjs");
const SLOT = "bridge-selftest";
const SLOT_ROOT = join(homedir(), ".traycer", "host", "dev-runs", SLOT);
const PID_FILE = join(SLOT_ROOT, "pid.json");

let failures = 0;
function check(label, condition, detail) {
  if (condition) {
    console.log(`  ok   ${label}`);
    return;
  }
  failures += 1;
  console.log(`  FAIL ${label}${detail === undefined ? "" : ` - ${detail}`}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A stand-in for the remote host: captures the request head it is sent, then
// keeps the socket open so the bridge's pipe stays established.
function startFakeRemote() {
  const heads = [];
  const server = net.createServer((socket) => {
    let buf = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      const end = buf.indexOf("\r\n\r\n");
      if (end !== -1) {
        heads.push(buf.subarray(0, end).toString("latin1"));
        socket.write("HTTP/1.1 101 Switching Protocols\r\n\r\n");
      }
    });
    socket.on("error", () => socket.destroy());
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () =>
      resolve({ server, heads, port: server.address().port }),
    );
  });
}

function runBridge(env) {
  const child = spawn(process.execPath, [BRIDGE], {
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const out = { stdout: "", stderr: "", code: null };
  child.stdout.on("data", (d) => (out.stdout += d));
  child.stderr.on("data", (d) => (out.stderr += d));
  child.on("exit", (code) => (out.code = code));
  return { child, out };
}

async function main() {
  rmSync(SLOT_ROOT, { recursive: true, force: true });
  const remote = await startFakeRemote();
  const target = `ws://127.0.0.1:${remote.port}`;

  console.log("\nbridge forwards and publishes:");
  const { child, out } = runBridge({
    TRAYCER_BRIDGE_TARGET: target,
    TRAYCER_BRIDGE_HOST_VERSION: "9.9.9-test",
    TRAYCER_BRIDGE_ENV: "dev",
    DEV_DESKTOP_SLOT: SLOT,
  });

  // Wait for the listening line rather than a fixed sleep.
  for (let i = 0; i < 100 && !out.stdout.includes("published"); i++) await sleep(50);

  check("pid.json published", existsSync(PID_FILE), out.stderr || out.stdout);
  if (!existsSync(PID_FILE)) {
    child.kill();
    remote.server.close();
    return;
  }

  const meta = JSON.parse(readFileSync(PID_FILE, "utf8"));
  check("pid is this bridge's real, live process", meta.pid === child.pid, `${meta.pid} vs ${child.pid}`);
  check("version is the operator-supplied one", meta.version === "9.9.9-test", meta.version);
  check("hostId is stable and NOT uuid-shaped", /^bridge-[0-9a-f]{12}$/.test(meta.hostId), meta.hostId);
  check("startedAt is ISO-8601", !Number.isNaN(Date.parse(meta.startedAt)), meta.startedAt);

  // The exact predicate the desktop applies (`isCurrentHostWebsocketUrl`).
  const url = new URL(meta.websocketUrl);
  check(
    "endpoint satisfies the desktop's local-host contract",
    (url.protocol === "ws:" || url.protocol === "wss:") &&
      url.hostname === "127.0.0.1" &&
      url.port !== "" &&
      url.pathname === "/rpc",
    meta.websocketUrl,
  );

  // Drive a real upgrade through the bridge on the /stream path - the one the
  // stream client rewrites to, and the one a path-forcing proxy would break.
  const client = net.connect({ host: "127.0.0.1", port: Number(url.port) });
  await new Promise((r) => client.on("connect", r));
  client.write(
    "GET /stream HTTP/1.1\r\n" +
      "Host: 127.0.0.1\r\n" +
      "Origin: http://127.0.0.1\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n\r\n",
  );
  for (let i = 0; i < 100 && remote.heads.length === 0; i++) await sleep(50);

  check("upstream received the forwarded upgrade", remote.heads.length === 1, String(remote.heads.length));
  const head = remote.heads[0] ?? "";
  check("path preserved (/stream, not forced to /rpc)", head.startsWith("GET /stream "), head.split("\r\n")[0]);
  check(
    "Host rewritten to the remote",
    head.includes(`Host: 127.0.0.1:${remote.port}`),
    head.split("\r\n").find((l) => l.startsWith("Host:")),
  );
  check(
    "Origin rewritten to the remote",
    head.includes(`Origin: http://127.0.0.1:${remote.port}`),
    head.split("\r\n").find((l) => l.startsWith("Origin:")),
  );
  check("Upgrade header passed through untouched", head.includes("Upgrade: websocket"));

  client.destroy();

  console.log("\nbridge retracts the host on exit:");
  // Closing stdin rather than signalling: Windows turns `kill(SIGTERM)` into
  // TerminateProcess, which runs no handler, so a signal cannot be the
  // portable graceful-stop path this asserts.
  child.stdin.end();
  for (let i = 0; i < 100 && existsSync(PID_FILE); i++) await sleep(50);
  check("pid.json unlinked when stdin closes", !existsSync(PID_FILE));

  console.log("\nbridge self-heals a pid.json left by a hard kill:");
  const first = runBridge({
    TRAYCER_BRIDGE_TARGET: target,
    TRAYCER_BRIDGE_HOST_VERSION: "9.9.9-test",
    TRAYCER_BRIDGE_ENV: "dev",
    DEV_DESKTOP_SLOT: SLOT,
  });
  for (let i = 0; i < 100 && !first.out.stdout.includes("published"); i++) await sleep(50);
  const abandonedPid = JSON.parse(readFileSync(PID_FILE, "utf8")).pid;
  first.child.kill("SIGKILL");
  await new Promise((r) => first.child.on("exit", r));
  check("hard kill does leave a stale pid.json (documented, not silent)", existsSync(PID_FILE));

  const second = runBridge({
    TRAYCER_BRIDGE_TARGET: target,
    TRAYCER_BRIDGE_HOST_VERSION: "9.9.9-test",
    TRAYCER_BRIDGE_ENV: "dev",
    DEV_DESKTOP_SLOT: SLOT,
  });
  for (let i = 0; i < 100 && !second.out.stdout.includes("published"); i++) await sleep(50);
  const healed = JSON.parse(readFileSync(PID_FILE, "utf8"));
  check(
    "a restart overwrites it with the live pid",
    healed.pid === second.child.pid && healed.pid !== abandonedPid,
    `${abandonedPid} -> ${healed.pid} (expected ${second.child.pid})`,
  );
  second.child.stdin.end();
  for (let i = 0; i < 100 && existsSync(PID_FILE); i++) await sleep(50);

  console.log("\nbridge refuses unsafe / incomplete configs:");
  const cases = [
    ["production slot is refused", { TRAYCER_BRIDGE_TARGET: target, TRAYCER_BRIDGE_HOST_VERSION: "1", TRAYCER_BRIDGE_ENV: "production" }, "PRODUCTION"],
    ["missing target is refused", { TRAYCER_BRIDGE_HOST_VERSION: "1", DEV_DESKTOP_SLOT: SLOT }, "TRAYCER_BRIDGE_TARGET"],
    ["missing version is refused", { TRAYCER_BRIDGE_TARGET: target, DEV_DESKTOP_SLOT: SLOT }, "TRAYCER_BRIDGE_HOST_VERSION"],
    ["unreachable target is refused before publishing", { TRAYCER_BRIDGE_TARGET: "ws://127.0.0.1:1", TRAYCER_BRIDGE_HOST_VERSION: "1", DEV_DESKTOP_SLOT: SLOT }, "not reachable"],
  ];
  for (const [label, env, expect] of cases) {
    const run = runBridge({
      TRAYCER_BRIDGE_TARGET: "",
      TRAYCER_BRIDGE_HOST_VERSION: "",
      TRAYCER_BRIDGE_ENV: "dev",
      DEV_DESKTOP_SLOT: "",
      ...env,
    });
    await new Promise((r) => run.child.on("exit", r));
    check(label, run.out.code === 1 && run.out.stderr.includes(expect), `code=${run.out.code} stderr=${run.out.stderr.trim()}`);
  }
  check("no pid.json left behind by any refusal", !existsSync(PID_FILE));

  remote.server.close();
  rmSync(SLOT_ROOT, { recursive: true, force: true });

  console.log(failures === 0 ? "\nall checks passed\n" : `\n${failures} check(s) FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
}

await main();
