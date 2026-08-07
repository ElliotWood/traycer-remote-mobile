#!/usr/bin/env node
// Loopback bridge: presents a remote Traycer host as a LOCAL host to the
// desktop client. See README.md for why this exists and what would retire it.
//
// The desktop only accepts a local host at `ws://127.0.0.1:<port>/rpc`
// (`isCurrentHostWebsocketUrl`), and only accepts a remote host through
// Traycer's relay with a Noise-NK handshake. A self-hosted box reachable at
// its own `wss://.../rpc` fits neither. This process is the missing shape: a
// real, live, loopback listener that forwards bytes to that box.
//
// Deliberately a RAW TCP passthrough rather than a WebSocket proxy. After the
// HTTP upgrade the WS framing is opaque, so `/rpc`, `/stream` and the
// unauthenticated `GET /activity` side-channel all work without this file
// knowing anything about them. The only bytes it inspects are the request
// head, whose `Host`/`Origin` must name the remote rather than loopback.

import net from "node:net";
import tls from "node:tls";
import { createHash } from "node:crypto";
import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ---- Config ---------------------------------------------------------------

// No defaults for the two values that are deployment-specific: an endpoint
// baked into a tracked file would be both a leak and a stale fact. The host
// version is required rather than guessed because the desktop's convergence
// check compares it, and a wrong guess there is a silent misbehaviour.
const TARGET = process.env.TRAYCER_BRIDGE_TARGET ?? "";
const HOST_VERSION = process.env.TRAYCER_BRIDGE_HOST_VERSION ?? "";
const LISTEN_PORT = Number(process.env.TRAYCER_BRIDGE_PORT ?? 0);
const ENVIRONMENT = process.env.TRAYCER_BRIDGE_ENV ?? "dev";
const SLOT_RAW = process.env.DEV_DESKTOP_SLOT ?? "";
// Opt-in, because a box fronted by an ACME *staging* certificate (or any
// self-signed one) is otherwise rejected outright by Node's default
// verification, and the resulting error names the CA rather than the cause.
// Off by default and announced on every run when on: this disables the only
// thing authenticating the far end of the tunnel.
const INSECURE_TLS = process.env.TRAYCER_BRIDGE_INSECURE_TLS === "1";

function die(message) {
  console.error(`[bridge] ${message}`);
  process.exit(1);
}

if (TARGET.length === 0) {
  die(
    "TRAYCER_BRIDGE_TARGET is required, e.g. wss://host.example (origin only - " +
      "the client's own path is forwarded unchanged).",
  );
}
if (HOST_VERSION.length === 0) {
  die(
    "TRAYCER_BRIDGE_HOST_VERSION is required - set it to the version the REMOTE " +
      "host actually reports, so the desktop's convergence check sees the truth.",
  );
}

let target;
try {
  target = new URL(TARGET);
} catch {
  die(`TRAYCER_BRIDGE_TARGET is not a URL: ${TARGET}`);
}
if (target.protocol !== "wss:" && target.protocol !== "ws:") {
  die(`TRAYCER_BRIDGE_TARGET must be ws:// or wss://, got ${target.protocol}`);
}
const targetSecure = target.protocol === "wss:";
const targetPort = target.port === "" ? (targetSecure ? 443 : 80) : Number(target.port);
// What the remote's own vhost/TLS expects to see - `host:port` with the port
// elided when it is the scheme default, matching how a browser would send it.
const targetHostHeader =
  target.port === "" ? target.hostname : `${target.hostname}:${target.port}`;
const targetOrigin = `${targetSecure ? "https" : "http"}://${targetHostHeader}`;

// ---- Slot resolution ------------------------------------------------------

// Byte-for-byte the rule in `clients/shared/platform/dev-desktop-slot.ts` and
// `host-paths.ts#hostSlotRoot`. If those drift, the desktop reads a different
// pid.json than we write and the bridge silently does nothing.
function sanitizeSlot(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}

const base = join(homedir(), ".traycer", "host");
const slot = ENVIRONMENT === "dev" ? sanitizeSlot(SLOT_RAW) : "";
const rootDir =
  slot.length > 0
    ? join(base, "dev-runs", slot)
    : ENVIRONMENT === "production"
      ? base
      : join(base, ENVIRONMENT);

// The whole safety argument for this tool is that it never touches the
// production host's coordination file. That is worth an assertion rather than
// a convention - a mistyped TRAYCER_BRIDGE_ENV should fail loudly, not
// overwrite the daily driver's pid.json.
if (rootDir === base) {
  die(
    "refusing to run against the PRODUCTION host slot. Set DEV_DESKTOP_SLOT " +
      "(with TRAYCER_BRIDGE_ENV=dev) so this bridge gets its own isolated root.",
  );
}

const pidMetadataFile = join(rootDir, "pid.json");
const hostNameFile = join(rootDir, "host-name.json");

// The desktop labels a LOCAL host with `os.hostname()` - the machine the app is
// running on, which is right for a real local host and actively misleading for
// a bridged one: the picker would name your own laptop while every command runs
// somewhere else. `host-display-name.ts` reads a `customName` from this file in
// the slot root and prefers it, so the bridge names itself after the machine it
// actually reaches.
const label =
  process.env.TRAYCER_BRIDGE_LABEL ?? `${target.hostname.split(".")[0]} (bridged)`;

// Stable across restarts so the host picker and the client's host-scoped
// caches do not churn on every bounce. Deliberately NOT uuid-shaped: the
// stream client skips delegated-credential provisioning entirely for a
// non-uuid hostId, which is the correct outcome for a host whose real
// identity lives on the other side of this bridge.
const hostId = `bridge-${createHash("sha256").update(TARGET).digest("hex").slice(0, 12)}`;

// ---- Connection forwarding ------------------------------------------------

function rewriteRequestHead(head) {
  const lines = head.split("\r\n");
  return lines
    .map((line) => {
      if (/^host:/i.test(line)) return `Host: ${targetHostHeader}`;
      // The remote rejects a loopback Origin the same way our own host rejects
      // a non-loopback one. Only rewritten when the client sent one.
      if (/^origin:/i.test(line)) return `Origin: ${targetOrigin}`;
      return line;
    })
    .join("\r\n");
}

function openUpstream() {
  return targetSecure
    ? tls.connect({
        host: target.hostname,
        port: targetPort,
        servername: target.hostname,
        rejectUnauthorized: !INSECURE_TLS,
      })
    : net.connect({ host: target.hostname, port: targetPort });
}

function handleConnection(inbound) {
  inbound.on("error", () => inbound.destroy());

  let buffered = Buffer.alloc(0);

  const onData = (chunk) => {
    buffered = Buffer.concat([buffered, chunk]);
    const headEnd = buffered.indexOf("\r\n\r\n");
    if (headEnd === -1) {
      // A request head this large is not a Traycer client. Drop it rather than
      // buffering without bound.
      if (buffered.length > 64 * 1024) inbound.destroy();
      return;
    }
    inbound.off("data", onData);

    const head = rewriteRequestHead(buffered.subarray(0, headEnd).toString("latin1"));
    const rest = buffered.subarray(headEnd + 4);

    const upstream = openUpstream();
    upstream.on("error", (err) => {
      // Fail FAST and visibly. A hung socket here is what makes a client sit in
      // a connecting/stale state with nothing to act on; a destroyed socket
      // surfaces as an ordinary dial failure the client already handles.
      console.error(`[bridge] upstream connection failed: ${err.message}`);
      inbound.destroy();
      upstream.destroy();
    });
    upstream.on(targetSecure ? "secureConnect" : "connect", () => {
      upstream.write(head + "\r\n\r\n");
      if (rest.length > 0) upstream.write(rest);
      inbound.pipe(upstream);
      upstream.pipe(inbound);
    });
    inbound.on("close", () => upstream.destroy());
    upstream.on("close", () => inbound.destroy());
  };

  inbound.on("data", onData);
}

// ---- Preflight ------------------------------------------------------------

// Prove the remote is reachable BEFORE publishing pid.json. An unreachable
// target then means the desktop simply sees no host at all - a state it
// handles well - instead of a published endpoint that never answers, which is
// the ambiguous case that produces an unactionable stuck connection.
function preflight() {
  return new Promise((resolve, reject) => {
    const probe = openUpstream();
    const done = (err) => {
      probe.removeAllListeners();
      probe.destroy();
      err ? reject(err) : resolve();
    };
    probe.setTimeout(10_000, () => done(new Error("timed out after 10s")));
    probe.on("error", done);
    probe.on(targetSecure ? "secureConnect" : "connect", () => done(null));
  });
}

// ---- pid.json -------------------------------------------------------------

let published = false;

function publish(port) {
  mkdirSync(rootDir, { recursive: true });
  // Overwrites unconditionally, which is also the self-heal for a pid.json
  // left behind by a hard kill (see `stop()` - Windows cannot run a handler on
  // TerminateProcess). A stale record is never mistaken for a live host: the
  // desktop's liveness probe resolves the dead pid to "dead" on its own.
  // Matches `HostPidMetadata`. `processStartTimeMs` / `processStartIdentity`
  // are omitted on purpose: they are documented as absent in legacy records,
  // and absence means "cannot compare identity", never "different process".
  // The liveness probe still positively confirms this real pid, so the desktop
  // reaches its `alive` verdict on honest evidence rather than a fabricated
  // identity stamp.
  writeFileSync(hostNameFile, `${JSON.stringify({ customName: label }, null, 2)}\n`);
  writeFileSync(
    pidMetadataFile,
    `${JSON.stringify(
      {
        pid: process.pid,
        hostId,
        version: HOST_VERSION,
        websocketUrl: `ws://127.0.0.1:${port}/rpc`,
        startedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
  published = true;
}

function unpublish() {
  if (!published) return;
  published = false;
  // The desktop reads an unlinked pid.json as a deliberate stop, which is
  // exactly what Ctrl-C is. Leaving it behind would instead read as a crashed
  // host and invite a respawn of a host this slot does not have.
  try {
    unlinkSync(pidMetadataFile);
    unlinkSync(hostNameFile);
  } catch {
    // Already gone, or the directory was cleaned up under us - either way
    // there is nothing left to retract.
  }
}

// ---- Main -----------------------------------------------------------------

const server = net.createServer(handleConnection);

try {
  await preflight();
} catch (err) {
  // A certificate failure is the one preflight error whose message names the
  // symptom rather than the fix, so it gets the fix spelled out.
  const certHint = /certificate|self.signed|unable to verify|CERT_/i.test(err.message)
    ? "\n         The remote's certificate did not verify. If it is fronted by an ACME\n" +
      "         staging or self-signed certificate, re-run with TRAYCER_BRIDGE_INSECURE_TLS=1."
    : "";
  die(
    `remote host is not reachable at ${TARGET} (${err.message}).${certHint}\n` +
      "         Nothing was published - the desktop will see no host in this slot.",
  );
}

server.on("error", (err) => die(`listen failed: ${err.message}`));

server.listen(LISTEN_PORT, "127.0.0.1", () => {
  const { port } = server.address();
  publish(port);
  console.log(`[bridge] forwarding ws://127.0.0.1:${port}  ->  ${TARGET}`);
  console.log(`[bridge] published ${pidMetadataFile}`);
  console.log(`[bridge] hostId ${hostId}, reporting version ${HOST_VERSION}`);
  console.log(`[bridge] host label "${label}"`);
  if (INSECURE_TLS) {
    console.log(
      "[bridge] WARNING: TLS verification is DISABLED for the upstream connection.",
    );
  }
  console.log("[bridge] Ctrl-C to stop and retract the host.");
});

function stop(reason) {
  console.log(`\n[bridge] ${reason} - retracting host.`);
  unpublish();
  process.exit(0);
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) {
  process.on(signal, () => stop(signal));
}
// Windows turns `kill(SIGTERM)` into TerminateProcess, which runs no handler
// at all - so a signal is not a portable way to ask this to stop cleanly.
// Closing stdin is: it works identically everywhere, and it means a parent
// that dies takes the bridge (and its published host) with it rather than
// orphaning both.
process.stdin.on("end", () => stop("stdin closed"));
process.stdin.on("close", () => stop("stdin closed"));
process.stdin.resume();

process.on("exit", unpublish);
