import { WebSocket as NodeWebSocket } from "ws";
import type {
  IWebSocketFactory,
  WebSocketCloseEvent,
  WebSocketErrorEvent,
  WebSocketLike,
  WebSocketMessageEvent,
  WebSocketOpenEvent,
} from "./ws-factory";

/**
 * `IWebSocketFactory` over the `ws` package's WHATWG-compatible `WebSocket`
 * class - the Node counterpart to `whatwg-ws-factory.ts`, for shells with no
 * usable `globalThis.WebSocket` (every plain Node process: the remote bridge,
 * `remote-agent`, and any future Node-hosted headless client).
 *
 * `globalThis.WebSocket` is NOT a safe substitute here. The one workspace
 * package that actually publishes a Node floor - `@traycerai/cli`
 * (`clients/traycer-cli/package.json`, `node >=20.18.0`, esbuild-bundled with
 * `@traycer-clients/shared` inlined, zero runtime deps) - declares a floor
 * where the global does not exist: verified empirically against a real
 * Node v20.18.0 binary, `typeof globalThis.WebSocket === "undefined"` unless
 * the process is launched with `--experimental-websocket`, which nothing in
 * the CLI's bin sets. `ws` has no such gap on any supported Node version.
 *
 * `WsRpcClient` always sends string payloads, so `binaryType` is left at its
 * default (`"nodebuffer"`, irrelevant for a text-only client). Compression:
 * `ws`'s `perMessageDeflate` defaults to enabled, matched here explicitly for
 * parity with `WhatwgStreamWebSocket`'s browser negotiation, which also
 * offers the extension by default.
 */
class NodeWebSocketAdapter implements WebSocketLike {
  onopen: ((event: WebSocketOpenEvent) => void) | null = null;
  onmessage: ((event: WebSocketMessageEvent) => void) | null = null;
  onerror: ((event: WebSocketErrorEvent) => void) | null = null;
  onclose: ((event: WebSocketCloseEvent) => void) | null = null;

  private readonly native: NodeWebSocket;

  constructor(url: string) {
    this.native = new NodeWebSocket(url, [], { perMessageDeflate: true });
    this.native.addEventListener("open", () => {
      this.onopen?.({ type: "open" });
    });
    this.native.addEventListener("message", (event: { data: unknown }) => {
      const data =
        typeof event.data === "string" ? event.data : String(event.data);
      this.onmessage?.({ data });
    });
    this.native.addEventListener("error", (event: { message?: string }) => {
      this.onerror?.({
        message: event.message ?? "WebSocket transport error",
      });
    });
    this.native.addEventListener(
      "close",
      (event: { code: number; reason: string; wasClean: boolean }) => {
        this.onclose?.({
          code: event.code,
          reason: event.reason,
          wasClean: event.wasClean,
        });
      },
    );
  }

  send(data: string): void {
    this.native.send(data);
  }

  close(code: number, reason: string): void {
    this.native.close(code, reason);
  }
}

export function createNodeWebSocketFactory(): IWebSocketFactory {
  return {
    create(url: string): WebSocketLike {
      return new NodeWebSocketAdapter(url);
    },
  };
}
