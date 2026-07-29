import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import type { AddressInfo } from "node:net";
import { createNodeStreamWebSocketFactory } from "../node-ws-stream-factory";
import type { StreamWebSocketLike } from "../ws-stream-factory";

/**
 * Exercises `createNodeStreamWebSocketFactory()` against a REAL local `ws`
 * server - the binary-capable adapter (`IStreamWebSocketFactory`) backing
 * `WsStreamClient`'s `/stream` transport (Y.Doc snapshot/update bytes). Each
 * case proves a real wire behavior, not a stubbed assumption - in particular
 * that binary frames arrive tagged as `Uint8Array` (never the Node `Buffer`
 * default, never a `Blob`), since a mismatch there is a silent frame-drop in
 * `WsStreamClient` (it only checks `event.data instanceof ArrayBuffer`
 * upstream of this adapter's own tagging).
 */

let servers: WebSocketServer[] = [];

function startServer(
  handler: (socket: import("ws").WebSocket) => void,
): { url: string; wss: WebSocketServer } {
  const wss = new WebSocketServer({ port: 0, perMessageDeflate: true });
  servers.push(wss);
  wss.on("connection", handler);
  const address = wss.address() as AddressInfo;
  return { url: `ws://127.0.0.1:${address.port}/`, wss };
}

afterEach(() => {
  for (const wss of servers) {
    wss.close();
    for (const client of wss.clients) client.terminate();
  }
  servers = [];
});

function waitForOpen(socket: StreamWebSocketLike): Promise<void> {
  return new Promise((resolve) => {
    socket.onopen = () => resolve();
  });
}

function waitForClose(socket: StreamWebSocketLike): Promise<{
  code: number;
  reason: string;
  wasClean: boolean;
}> {
  return new Promise((resolve) => {
    socket.onclose = (event) => resolve(event);
  });
}

describe("createNodeStreamWebSocketFactory (real ws server)", () => {
  it("opens and exchanges a text envelope", async () => {
    const { url } = startServer((socket) => {
      socket.on("message", (data, isBinary) => socket.send(data, { binary: isBinary }));
    });
    const factory = createNodeStreamWebSocketFactory();
    const socket = factory.create(url);
    await waitForOpen(socket);

    const message = new Promise<{ type: string; data: unknown }>((resolve) => {
      socket.onmessage = (event) => resolve(event);
    });
    socket.send(JSON.stringify({ kind: "ping" }));
    const event = await message;

    expect(event.type).toBe("text");
    expect(event.data).toBe(JSON.stringify({ kind: "ping" }));

    socket.close(1000, "done");
  });

  it("exchanges a binary payload tagged as Uint8Array with byte-exact round trip", async () => {
    const { url } = startServer((socket) => {
      socket.on("message", (data, isBinary) => socket.send(data, { binary: isBinary }));
    });
    const factory = createNodeStreamWebSocketFactory();
    const socket = factory.create(url);
    await waitForOpen(socket);

    const message = new Promise<{ type: string; data: unknown }>((resolve) => {
      socket.onmessage = (event) => resolve(event);
    });
    const payload = new Uint8Array([1, 2, 3, 250, 251, 0, 255]);
    socket.send(payload);
    const event = await message;

    expect(event.type).toBe("binary");
    expect(event.data).toBeInstanceOf(Uint8Array);
    expect(event.data).not.toBeInstanceOf(Blob);
    expect(Array.from(event.data as Uint8Array)).toEqual(Array.from(payload));

    socket.close(1000, "done");
  });

  it("reports a clean local close with the exact code and reason", async () => {
    const { url } = startServer(() => {});
    const factory = createNodeStreamWebSocketFactory();
    const socket = factory.create(url);
    await waitForOpen(socket);

    const closed = waitForClose(socket);
    socket.close(1000, "client done");
    const event = await closed;

    expect(event.code).toBe(1000);
    expect(event.reason).toBe("client done");
    expect(event.wasClean).toBe(true);
  });

  it("delivers a server-initiated close with a non-1000 code and reason intact", async () => {
    const { url } = startServer((socket) => {
      socket.on("message", () => {
        socket.close(4002, "server evicting client");
      });
    });
    const factory = createNodeStreamWebSocketFactory();
    const socket = factory.create(url);
    await waitForOpen(socket);

    const closed = waitForClose(socket);
    socket.send("trigger-server-close");
    const event = await closed;

    expect(event.code).toBe(4002);
    expect(event.reason).toBe("server evicting client");
    expect(event.wasClean).toBe(true);
  });

  it("fires onclose (not a hang) when the connection is refused", async () => {
    const factory = createNodeStreamWebSocketFactory();
    const socket = factory.create("ws://127.0.0.1:1/");

    const closed = waitForClose(socket);
    let errorFired = false;
    socket.onerror = () => {
      errorFired = true;
    };

    const event = await closed;
    expect(errorFired).toBe(true);
    expect(event.wasClean).toBe(false);
  });

  it("fires error then close (not a silent no-op) when close() is called mid-dial", async () => {
    const { url } = startServer(() => {});
    const factory = createNodeStreamWebSocketFactory();
    const socket = factory.create(url);

    const closed = waitForClose(socket);
    let errorFired = false;
    socket.onerror = () => {
      errorFired = true;
    };
    // Unlike the WHATWG browser adapter (which must defer close() until
    // open to avoid a browser console warning), `ws` aborts the in-flight
    // handshake immediately - this must not hang or silently drop the
    // close intent.
    socket.close(1000, "abandoned mid-dial");
    const event = await closed;

    expect(errorFired).toBe(true);
    expect(event.wasClean).toBe(false);
  });

  it("negotiates permessage-deflate against a deflate-enabled server", async () => {
    const { url, wss } = startServer(() => {});
    const factory = createNodeStreamWebSocketFactory();
    const socket = factory.create(url);
    await waitForOpen(socket);

    expect(wss.clients.size).toBe(1);
    const [serverSocket] = wss.clients;
    expect(
      (serverSocket as unknown as { _extensions: Record<string, unknown> })
        ._extensions,
    ).toHaveProperty("permessage-deflate");

    socket.close(1000, "done");
  });
});
