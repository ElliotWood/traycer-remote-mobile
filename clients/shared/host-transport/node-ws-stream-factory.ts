import { WebSocket as NodeWebSocket } from "ws";
import type {
  WebSocketCloseEvent,
  WebSocketErrorEvent,
  WebSocketOpenEvent,
} from "./ws-factory";
import type {
  IStreamWebSocketFactory,
  StreamWebSocketLike,
  StreamWebSocketMessageEvent,
} from "./ws-stream-factory";

/**
 * Binary-capable `IStreamWebSocketFactory` over the `ws` package's
 * WHATWG-compatible `WebSocket` class - the Node counterpart to
 * `whatwg-stream-ws-factory.ts`, for the `/stream` transport (Y.Doc
 * snapshot/update bytes, awareness payloads) on any plain Node process.
 *
 * Why `ws` and not `globalThis.WebSocket` - see `node-ws-factory.ts` for the
 * full empirical writeup (Node 20.18.0 floor gap). Summary of what changes
 * for the *binary, stream* adapter specifically, each checked against a real
 * `ws` server rather than assumed:
 *
 *   - `binaryType = "arraybuffer"` (set below) makes `ws` deliver binary
 *     frames as `ArrayBuffer`, exactly like a browser `WebSocket` - so this
 *     class can reuse `whatwg-stream-ws-factory.ts`'s `event.data instanceof
 *     ArrayBuffer` tagging verbatim. Left unset, `ws` defaults to
 *     `"nodebuffer"` (a Node `Buffer`), which would silently fail that
 *     `instanceof ArrayBuffer` check and drop every binary frame - the
 *     dropped-frame trap the brief calls out in
 *     `whatwg-stream-ws-factory.ts:46-54`.
 *   - `wasClean`: `ws`'s `CloseEvent.wasClean` is a real computed field
 *     (`_closeFrameReceived && _closeFrameSent` - both sides completed the
 *     close handshake), not a stub - passed through as-is, no synthesis
 *     needed.
 *   - `close()` called while still `CONNECTING`: `ws` aborts the in-flight
 *     HTTP upgrade immediately (`abortHandshake`) and emits both `error`
 *     *and* `close` on the next tick - it does not need the browser
 *     adapter's `pendingClose`-until-`open` workaround
 *     (`whatwg-stream-ws-factory.ts:79-91`), which exists only because
 *     browsers log a warning (not an abort) for the same call. Callers that
 *     close mid-dial should expect an `onerror` immediately followed by
 *     `onclose`, not a silently swallowed intent.
 *
 * Compression: `perMessageDeflate` is requested explicitly. Measured (real
 * `ws` server, byte-counted proxy, single-connection isolation) at parity
 * with a browser/Node-global `WebSocket` for both a highly-redundant payload
 * and a realistic ~150KB chat-snapshot-shaped JSON payload - compression
 * ratio is not what decides this adapter; the Node 20 floor gap is.
 */
class NodeStreamWebSocket implements StreamWebSocketLike {
  onopen: ((event: WebSocketOpenEvent) => void) | null = null;
  onmessage: ((event: StreamWebSocketMessageEvent) => void) | null = null;
  onerror: ((event: WebSocketErrorEvent) => void) | null = null;
  onclose: ((event: WebSocketCloseEvent) => void) | null = null;

  private readonly native: NodeWebSocket;

  constructor(url: string) {
    this.native = new NodeWebSocket(url, [], { perMessageDeflate: true });
    this.native.binaryType = "arraybuffer";
    this.native.addEventListener("open", () => {
      this.onopen?.({ type: "open" });
    });
    this.native.addEventListener("message", (event: { data: unknown }) => {
      if (typeof event.data === "string") {
        this.onmessage?.({ type: "text", data: event.data });
        return;
      }
      if (event.data instanceof ArrayBuffer) {
        this.onmessage?.({ type: "binary", data: new Uint8Array(event.data) });
      }
    });
    this.native.addEventListener("error", (event: { message?: string }) => {
      this.onerror?.({
        message: event.message ?? "WebSocket stream transport error",
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

  send(data: string | Uint8Array): void {
    // `ws` discriminates text vs. binary by `typeof data !== "string"`, so a
    // `Uint8Array` needs no separate encoding path (unlike the WHATWG browser
    // adapter, which must copy into a fresh `ArrayBuffer`-backed view for the
    // DOM `BufferSource` type - `ws`'s sender accepts any typed array).
    this.native.send(data);
  }

  close(code: number, reason: string): void {
    this.native.close(code, reason);
  }
}

export function createNodeStreamWebSocketFactory(): IStreamWebSocketFactory {
  return {
    create(url: string): StreamWebSocketLike {
      return new NodeStreamWebSocket(url);
    },
  };
}
