// Tenant-routing WebSocket relay for the Traycer public ingress.
//
// Replaces the single-tenant `traycer-ws-deflate-proxy.mjs`, which was
// hardcoded to one tenant's pid.json. It keeps that relay's entire reason for
// existing (permessage-deflate on the internet-facing leg, ~4x measured on the
// only hop where bytes cost time) and adds the thing that makes the VM
// genuinely multi-tenant: it decides WHICH tenant's host a connection reaches.
//
//   browser --wss + deflate--> nginx --> THIS --plain ws--> tenant's host
//
// THE ROUTING KEY, AND WHY IT IS WHERE IT IS
// The bearer is not an HTTP header. `ClientOpenFrame` is
// `{ kind: "open", token, manifest }` (protocol/src/framework/ws-protocol.ts)
// - the token arrives as the FIRST WEBSOCKET MESSAGE, after the upgrade,
// because browsers cannot set headers on a WebSocket. nginx therefore cannot
// route on identity: it has no visibility past the upgrade. This relay must
// accept the socket, buffer until the open frame arrives, and only then choose
// an upstream. That ordering is forced by the protocol, not a design
// preference.
//
// The identity is NOT read out of the token. The token is presented to
// Traycer's own authn (`verifyTraycerPrincipal`), and the user id in the
// ANSWER is the routing key. A client presents a token; it cannot present an
// identity. Nothing else in the request - path, query, header, cookie, Origin,
// conversation id - influences tenant selection, so there is no field a caller
// can set to reach someone else's host.
//
// Resolution goes through the SAME `IdentityRegistry` the rest of the epic
// uses, imported rather than reimplemented. A second implementation of the
// security control living in a deploy script is precisely the divergence that
// hands one engineer another's credentials.
//
// FAILS CLOSED, ALWAYS. Unparseable first frame, non-open first frame, invalid
// token, authn unreachable, verified-but-unmapped identity, tenant whose host
// is not running - every one of these closes the socket. There is no default
// tenant and no first-configured-tenant fallback; a misconfiguration yields no
// service rather than the wrong person's service.
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { WebSocketServer, WebSocket, type RawData } from "ws";
// Relative, not `@traycer-clients/shared/...`: this file is deliberately NOT a
// workspace package (adding one would put an infra script into nx's project
// graph and every repo-wide target). The bundler resolves these at build time
// and the deployed artifact has no import paths at all — see build.sh.
import { IdentityRegistry } from "../../../clients/shared/identity-registry/registry";
import {
  verifyTraycerPrincipal,
  DEFAULT_TRAYCER_VERIFY_TIMEOUT_MS,
  DEFAULT_MAX_CONCURRENT_VERIFICATIONS,
} from "../../../clients/shared/identity-registry/traycer-principal";
import type { TenantMapping } from "../../../clients/shared/identity-registry/types";

interface RouterConfig {
  readonly listenPort: number;
  readonly registryPath: string;
  readonly authnBaseUrl: string;
  readonly openFrameTimeoutMs: number;
}

/**
 * Every value is required. No default registry path, no default authn URL -
 * an unset one is a startup failure, never a silently-assumed endpoint.
 */
function loadConfig(argv: readonly string[], env: NodeJS.ProcessEnv): RouterConfig {
  const listenPort = Number(argv[2]);
  if (!Number.isInteger(listenPort) || listenPort < 1 || listenPort > 65535) {
    throw new Error(`tenant-router: argv[2] must be a valid listen port, got "${argv[2]}"`);
  }
  const registryPath = argv[3];
  if (registryPath === undefined || registryPath.length === 0) {
    throw new Error("tenant-router: argv[3] must be the identity-registry config path");
  }
  const authnBaseUrl = env.TRAYCER_AUTHN_BASE_URL;
  if (authnBaseUrl === undefined || authnBaseUrl.length === 0) {
    throw new Error(
      "tenant-router: TRAYCER_AUTHN_BASE_URL is required (the authn service that vouches for inbound bearers) — refusing to start without it.",
    );
  }
  return {
    listenPort,
    registryPath,
    authnBaseUrl,
    openFrameTimeoutMs: Number(env.TRAYCER_OPEN_FRAME_TIMEOUT_MS ?? 15_000),
  };
}

const config = loadConfig(process.argv, process.env);

// Loaded once at startup and NOT hot-reloaded: `IdentityRegistry.fromFile`
// throws on an absent/malformed/ambiguous config, so a bad edit must fail the
// service loudly at start rather than swap routing under live connections.
// Changing tenants is a deliberate `systemctl restart`.
const registry = IdentityRegistry.fromFile(config.registryPath, (line) =>
  process.stderr.write(`${line}\n`),
);

/**
 * Per-connection, never cached: the host binds a fresh ephemeral port on every
 * start, so a cached port is correct only until that tenant's next restart.
 * Inherited unchanged from the single-tenant relay, which learned this the
 * hard way (45731 -> 36705 within four minutes on the live VM).
 */
function hostPortFor(tenant: TenantMapping): number {
  const pidPath = `${tenant.home}/.traycer/host/pid.json`;
  const raw: unknown = JSON.parse(readFileSync(pidPath, "utf8"));
  if (raw === null || typeof raw !== "object") {
    throw new Error(`pid.json at ${pidPath} is not an object`);
  }
  const websocketUrl = (raw as Record<string, unknown>).websocketUrl;
  if (typeof websocketUrl !== "string") {
    throw new Error(`pid.json at ${pidPath} has no websocketUrl`);
  }
  const port = Number(new URL(websocketUrl).port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`pid.json at ${pidPath} advertised an unusable port`);
  }
  return port;
}

// The host enforces a loopback Origin and rejects anything else with 403. It
// must be the HTTP origin, NOT the ws:// URL — sending `ws://127.0.0.1:<port>`
// 403'd every connection and broke epic loading entirely. That cost a live
// outage once; do not "simplify" these two functions into one.
const httpOrigin = (port: number): string => `http://127.0.0.1:${port}`;
const wsUrl = (port: number, path: string): string => `ws://127.0.0.1:${port}${path}`;

/** Extracts the bearer from a first client frame, or null if it is not a well-formed open frame. */
function bearerFromOpenFrame(data: RawData, isBinary: boolean): string | null {
  if (isBinary) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(data.toString());
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object") return null;
  const frame = parsed as Record<string, unknown>;
  if (frame.kind !== "open") return null;
  const token = frame.token;
  return typeof token === "string" && token.length > 0 ? token : null;
}

/**
 * Refusal codes are deliberately coarse toward the client (1008 policy
 * violation) while the STDERR audit line carries the specific reason. A
 * caller probing for "does this identity exist" should not be able to
 * distinguish unmapped-identity from invalid-token by close code.
 */
const CLOSE_POLICY = 1008;
const CLOSE_UNAVAILABLE = 1011;

function auditRefusal(reason: string, detail: string): void {
  process.stderr.write(
    `${JSON.stringify({ component: "tenant-router", outcome: "refused", reason, detail, at: new Date().toISOString() })}\n`,
  );
}

const server = createServer((_req, res) => {
  res.writeHead(426, { "content-type": "text/plain" });
  res.end("upgrade required\n");
});

const wss = new WebSocketServer({
  server,
  // The inherited reason this relay exists. Tuned for throughput over ratio:
  // these payloads are large, already-structured JSON, so level 6 is well past
  // the knee.
  perMessageDeflate: {
    zlibDeflateOptions: { level: 6, memLevel: 8 },
    threshold: 1024,
    concurrencyLimit: 10,
  },
});

wss.on("connection", (client, req) => {
  const requestPath = req.url ?? "/rpc";
  let upstream: WebSocket | null = null;
  let routed = false;
  // Frames the client sends after `open` but before the upstream finishes
  // connecting. Buffered rather than dropped: each is a real user action, and
  // silently dropping one is the stuck-forever bug this project already fixed
  // client-side once.
  const pending: Array<{ data: RawData; isBinary: boolean }> = [];
  let upstreamOpen = false;

  // A socket that never sends a parseable open frame must not sit here
  // forever holding a slot.
  const openFrameTimer = setTimeout(() => {
    if (!routed) {
      auditRefusal("open_frame_timeout", requestPath);
      client.close(CLOSE_POLICY, "no open frame");
    }
  }, config.openFrameTimeoutMs);

  client.on("message", (data: RawData, isBinary: boolean) => {
    if (routed) {
      if (upstreamOpen && upstream !== null) upstream.send(data, { binary: isBinary });
      else pending.push({ data, isBinary });
      return;
    }

    // First frame: this is the routing decision, and the only chance to make it.
    routed = true;
    clearTimeout(openFrameTimer);

    const bearer = bearerFromOpenFrame(data, isBinary);
    if (bearer === null) {
      auditRefusal("first_frame_not_open", requestPath);
      client.close(CLOSE_POLICY, "expected open frame");
      return;
    }

    // The open frame itself must reach the host verbatim — the host does its
    // own token validation and manifest negotiation on it. This relay reads
    // it, it does not consume it.
    pending.push({ data, isBinary });

    void routeConnection(bearer);
  });

  async function routeConnection(bearer: string): Promise<void> {
    const verification = await verifyTraycerPrincipal({
      bearer,
      authnBaseUrl: config.authnBaseUrl,
      timeoutMs: DEFAULT_TRAYCER_VERIFY_TIMEOUT_MS,
      fetchImpl: fetch,
      // Unauthenticated input reaches this call, so it must not be able to
      // turn inbound connections into unbounded outbound load on Traycer's
      // authn. Past the ceiling the connection is refused, not queued.
      maxConcurrent: DEFAULT_MAX_CONCURRENT_VERIFICATIONS,
    });
    if (verification.kind !== "verified") {
      // Includes authn being unreachable: refuse rather than route on a guess.
      auditRefusal(`token_${verification.reason}`, requestPath);
      client.close(CLOSE_POLICY, "unauthorized");
      return;
    }

    const resolution = registry.resolveTenant(verification.principal);
    if (resolution.kind !== "resolved") {
      auditRefusal(`registry_${resolution.reason}`, requestPath);
      client.close(CLOSE_POLICY, "unauthorized");
      return;
    }
    const tenant = resolution.tenant;

    let port: number;
    try {
      port = hostPortFor(tenant);
    } catch (err) {
      // Correctly routed, but that tenant's host is down. Distinct from a
      // refusal: this is unavailability of a known tenant, not a rejected one.
      auditRefusal("tenant_host_unavailable", `${tenant.hostId}: ${describe(err)}`);
      client.close(CLOSE_UNAVAILABLE, "host unavailable");
      return;
    }

    process.stderr.write(
      `${JSON.stringify({ component: "tenant-router", outcome: "routed", hostId: tenant.hostId, port, path: requestPath, at: new Date().toISOString() })}\n`,
    );

    upstream = new WebSocket(wsUrl(port, requestPath), {
      // Loopback leg: compression here would cost CPU and save nothing.
      perMessageDeflate: false,
      headers: { origin: httpOrigin(port) },
    });

    upstream.on("open", () => {
      upstreamOpen = true;
      for (const frame of pending.splice(0)) {
        upstream?.send(frame.data, { binary: frame.isBinary });
      }
    });
    upstream.on("message", (data: RawData, isBinary: boolean) => {
      if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary });
    });
    upstream.on("close", (code: number) => {
      try {
        client.close(code >= 1000 && code <= 4999 ? code : CLOSE_UNAVAILABLE);
      } catch {
        /* client already gone */
      }
    });
    upstream.on("error", (err: Error) => {
      process.stderr.write(`[tenant-router] upstream ${tenant.hostId}: ${describe(err)}\n`);
      try {
        client.close(CLOSE_UNAVAILABLE, "upstream error");
      } catch {
        /* client already gone */
      }
    });
  }

  client.on("close", () => {
    clearTimeout(openFrameTimer);
    try {
      upstream?.close();
    } catch {
      /* upstream already gone */
    }
  });
  client.on("error", () => {
    clearTimeout(openFrameTimer);
    try {
      upstream?.close();
    } catch {
      /* upstream already gone */
    }
  });
});

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

server.listen(config.listenPort, "127.0.0.1", () => {
  process.stderr.write(
    `[tenant-router] listening on 127.0.0.1:${String(config.listenPort)}, registry ${config.registryPath}, authn ${config.authnBaseUrl}\n`,
  );
});
