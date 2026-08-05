import net from "node:net";
import { timingSafeEqual } from "node:crypto";
import { readHostPidMetadata, isValidLocalHostWebsocketUrl } from "./pid-metadata";
import { forwardToLoopback } from "./loopback-forward";
import {
  bufferHttpHead,
  parseRequestLine,
  extractHeader,
  writeRawResponse,
} from "../shared/head-parser";

const ALLOWED_PATHS = new Set(["/rpc", "/stream"]);
// A custom header, not `Authorization: Bearer` - deliberately distinct from
// the client's actual bearer, which travels end-to-end inside the WS `open`
// frame (not an HTTP header at all - see the M1 contract's B1 correction)
// and must reach the host completely untouched. Using a different header
// name for the gateway<->agent hop keeps that end-to-end WS handshake
// (Sec-WebSocket-Key/Accept negotiated directly between client and host)
// unambiguous from this hop's own internal auth, and lets
// `loopback-forward.ts` strip this header before the host ever sees it.
export const AGENT_TUNNEL_TOKEN_HEADER = "X-Traycer-Agent-Token";

export interface TunnelServerOptions {
  readonly host: string;
  readonly port: number;
  readonly token: string;
  readonly pidJsonPath: () => string;
  readonly onEvent?: (event: TunnelServerEvent) => void;
}

export type TunnelServerEvent =
  | { readonly kind: "rejected"; readonly reason: "bad-path" | "bad-auth" | "host-not-running"; readonly path: string }
  | { readonly kind: "forwarded"; readonly path: string; readonly loopbackPort: number };

function timingSafeTokenEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * The agent's own tunnel listener - what the gateway dials. Two paths,
 * `/rpc` and `/stream`. Every upgrade must carry a matching
 * `X-Traycer-Agent-Token` or it is rejected before any byte reaches the
 * loopback host. Once accepted it is a raw byte pipe: this server never
 * parses a WS application frame (see `loopback-forward.ts`'s header
 * comment) - only the HTTP upgrade head that precedes it, and only to check
 * the path and the token.
 */
export function startTunnelServer(options: TunnelServerOptions): net.Server {
  const server = net.createServer((client) => {
    bufferHttpHead(client, ({ headBuffered, headEndIdx, bodyAfterHead }) => {
      void handleRequestHead(client, headBuffered, headEndIdx, bodyAfterHead, options);
    });
  });
  server.listen(options.port, options.host);
  return server;
}

async function handleRequestHead(
  client: net.Socket,
  headBuffered: Buffer,
  headEndIdx: number,
  bodyAfterHead: Buffer,
  options: TunnelServerOptions,
): Promise<void> {
  const head = headBuffered.subarray(0, headEndIdx).toString("utf8");

  const requestLine = parseRequestLine(head);
  const path = requestLine?.path ?? "";
  if (requestLine === null || !ALLOWED_PATHS.has(path)) {
    options.onEvent?.({ kind: "rejected", reason: "bad-path", path });
    writeRawResponse(client, 404, "Not Found");
    return;
  }

  const token = extractHeader(head, AGENT_TUNNEL_TOKEN_HEADER);
  if (token === null || !timingSafeTokenEquals(token, options.token)) {
    options.onEvent?.({ kind: "rejected", reason: "bad-auth", path });
    writeRawResponse(client, 401, "Unauthorized");
    return;
  }

  // Fresh per-connection read - the host picks a new random port on every
  // restart, so this must never be cached beyond this connection's lifetime.
  const metadata = await readHostPidMetadata(options.pidJsonPath());
  if (metadata === null || !isValidLocalHostWebsocketUrl(metadata.websocketUrl)) {
    options.onEvent?.({ kind: "rejected", reason: "host-not-running", path });
    writeRawResponse(client, 503, "Service Unavailable");
    return;
  }
  const loopbackPort = Number.parseInt(new URL(metadata.websocketUrl).port, 10);

  options.onEvent?.({ kind: "forwarded", path, loopbackPort });
  forwardToLoopback({ client, headBuffered, bodyAfterHead, loopbackPort });
}
