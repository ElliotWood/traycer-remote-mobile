import net from "node:net";
import type http from "node:http";
import type { Duplex } from "node:stream";
import { AGENT_TUNNEL_TOKEN_HEADER } from "../agent/tunnel-server";
import type { Registry, RegistryEntry } from "./registry";
import type { GatewayConfig } from "./config";
import { dialTimeoutMs } from "./config";

const HOSTED_PATH_RE = /^\/h\/([^/]+)\/(rpc|stream)$/;
const LEGACY_PATHS: Record<string, "rpc" | "stream"> = {
  "/rpc": "rpc",
  "/stream": "stream",
};

export type ProxyEvent =
  | {
      readonly kind: "rejected";
      readonly reason:
        "bad-path" | "host-unknown" | "host-offline" | "host-unreachable";
      readonly path: string;
      readonly hostId: string | null;
    }
  | {
      readonly kind: "forwarded";
      readonly path: string;
      readonly hostId: string;
    };

export interface ProxyOptions {
  readonly registry: Registry;
  readonly config: GatewayConfig;
  readonly onEvent?: (event: ProxyEvent) => void;
}

/**
 * Extracts only the headers a WS upgrade actually needs downstream -
 * `Upgrade`, `Connection`, and every `Sec-WebSocket-*` - so the handshake
 * (`Sec-WebSocket-Key`/`Accept`) is negotiated end-to-end between the real
 * client and the real host, untouched. Everything else about the client's
 * original request (`Host`, `Origin`, `X-Forwarded-*`, any
 * `Tailscale-User-*` identity headers the trusted local proxy injected) is
 * deliberately NOT carried onto the gateway's own dial to the agent - that
 * dial is constructed fresh, not copied, per the hop-termination design.
 */
function extractWsHandshakeHeaders(headers: http.IncomingHttpHeaders): string {
  const lines: string[] = [];
  for (const [name, value] of Object.entries(headers)) {
    if (!/^(upgrade|connection|sec-websocket-)/i.test(name)) continue;
    if (value === undefined) continue;
    const values = Array.isArray(value) ? value : [value];
    for (const v of values) lines.push(`${name}: ${v}`);
  }
  return lines.join("\r\n");
}

function resolveHostIdAndAllowedPath(
  path: string,
  config: GatewayConfig,
  registry: Registry,
): {
  readonly hostId: string | null;
  readonly agentPath: "rpc" | "stream";
} | null {
  const hostedMatch = HOSTED_PATH_RE.exec(path);
  if (hostedMatch !== null) {
    return {
      hostId: hostedMatch[1],
      agentPath: hostedMatch[2] as "rpc" | "stream",
    };
  }
  const legacyPath = LEGACY_PATHS[path];
  if (legacyPath !== undefined) {
    const entry = registry.get(config.legacyLocalAgentId);
    return { hostId: entry?.hostId ?? null, agentPath: legacyPath };
  }
  return null;
}

function rejectUpgrade(
  socket: Duplex,
  status: number,
  statusText: string,
  json: unknown,
): void {
  const payload = Buffer.from(JSON.stringify(json), "utf8");
  socket.end(
    Buffer.concat([
      Buffer.from(
        `HTTP/1.1 ${status} ${statusText}\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: ${payload.length}\r\n\r\n`,
        "utf8",
      ),
      payload,
    ]),
  );
}

/**
 * Serves `/h/{hostId}/rpc|stream` and the legacy bare `/rpc`/`/stream`
 * alias, via the standard Node `http.Server` `upgrade` event - Node's own
 * HTTP parser handles the request line/headers (robust against edge cases
 * a hand-rolled parser would miss), handing this a parsed `req` plus the
 * raw `socket` to splice. Each incoming connection is handled with its own
 * local state (R1) - no shared buffer/registry mutation across
 * connections, so concurrent dials to the same or different `hostId`s
 * never cross-talk.
 */
export function attachProxy(server: http.Server, options: ProxyOptions): void {
  server.on("upgrade", (req, socket, head) => {
    handleProxyUpgrade(req, socket, head, options);
  });
}

function handleProxyUpgrade(
  req: http.IncomingMessage,
  socket: Duplex,
  head: Buffer,
  options: ProxyOptions,
): void {
  const { registry, config, onEvent } = options;
  const path = (req.url ?? "").split("?")[0];

  const resolved = resolveHostIdAndAllowedPath(path, config, registry);
  if (resolved === null) {
    onEvent?.({ kind: "rejected", reason: "bad-path", path, hostId: null });
    rejectUpgrade(socket, 404, "Not Found", { error: "NOT_FOUND" });
    return;
  }

  const { hostId, agentPath } = resolved;
  if (hostId === null) {
    // Legacy alias with the primary's own agent never registered yet -
    // reads as offline, not "unknown route".
    onEvent?.({ kind: "rejected", reason: "host-offline", path, hostId: null });
    rejectUpgrade(socket, 503, "Service Unavailable", {
      error: "HOST_OFFLINE",
    });
    return;
  }

  const entry = registry.findByHostId(hostId);
  if (entry === null) {
    onEvent?.({ kind: "rejected", reason: "host-unknown", path, hostId });
    rejectUpgrade(socket, 404, "Not Found", { error: "HOST_UNKNOWN", hostId });
    return;
  }

  const status = registry.statusFor(hostId);
  if (status !== "available") {
    onEvent?.({ kind: "rejected", reason: "host-offline", path, hostId });
    rejectUpgrade(socket, 503, "Service Unavailable", {
      error: "HOST_OFFLINE",
      hostId,
    });
    return;
  }

  dialAgentAndSplice({
    req,
    socket,
    head,
    entry,
    agentPath,
    hostId,
    path,
    options,
  });
}

function dialAgentAndSplice(params: {
  readonly req: http.IncomingMessage;
  readonly socket: Duplex;
  readonly head: Buffer;
  readonly entry: RegistryEntry;
  readonly agentPath: "rpc" | "stream";
  readonly hostId: string;
  readonly path: string;
  readonly options: ProxyOptions;
}): void {
  const { req, socket, head, entry, agentPath, hostId, path, options } = params;
  const { config, onEvent } = options;

  const reachable = new URL(entry.reachableUrl);
  const agentPort = Number.parseInt(reachable.port, 10);
  const agentToken = config.agents[entry.agentId]?.token;
  if (agentToken === undefined) {
    // Registered agentId has no configured token - treat as unreachable
    // rather than dialing with no auth (the agent's tunnel listener would
    // just reject it anyway; failing fast here is honest sooner).
    onEvent?.({ kind: "rejected", reason: "host-unreachable", path, hostId });
    rejectUpgrade(socket, 503, "Service Unavailable", {
      error: "HOST_UNREACHABLE",
      hostId,
    });
    return;
  }

  const upstream = net.connect(agentPort, reachable.hostname);
  let settled = false;

  const failUnreachable = (): void => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    upstream.destroy();
    onEvent?.({ kind: "rejected", reason: "host-unreachable", path, hostId });
    rejectUpgrade(socket, 503, "Service Unavailable", {
      error: "HOST_UNREACHABLE",
      hostId,
    });
  };

  // Bounded dial timeout (B6 / check 13): "available" per the registry's
  // heartbeat is not proof the agent's tunnel listener will actually
  // accept a connection right now - a hang here must never become a hang
  // for the client.
  const timeout = setTimeout(failUnreachable, dialTimeoutMs(config));

  upstream.on("connect", () => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);

    const wsHeaders = extractWsHandshakeHeaders(req.headers);
    // Constructed fresh for this hop - deliberately not copying the
    // client's Host/Origin/X-Forwarded-*/Tailscale-User-* headers onward.
    const agentHead =
      `GET /${agentPath} HTTP/1.1\r\n` +
      `Host: ${reachable.hostname}:${agentPort}\r\n` +
      `${AGENT_TUNNEL_TOKEN_HEADER}: ${agentToken}\r\n` +
      (wsHeaders.length > 0 ? `${wsHeaders}\r\n` : "") +
      `\r\n`;

    onEvent?.({ kind: "forwarded", path, hostId });
    upstream.write(Buffer.concat([Buffer.from(agentHead, "utf8"), head]));

    socket.on("error", () => upstream.destroy());
    upstream.on("error", () => socket.destroy());
    upstream.pipe(socket);
    socket.pipe(upstream);
  });

  upstream.on("error", failUnreachable);
}
