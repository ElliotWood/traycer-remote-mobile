import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import type { AddressInfo } from "node:net";
import { createNodeWebSocketFactory } from "../node-ws-factory";
import type { WebSocketLike } from "../ws-factory";

/**
 * Exercises `createNodeWebSocketFactory()` against a REAL local `ws` server -
 * no stubs. This is the text-only unary adapter (`IWebSocketFactory`), the
 * Node counterpart to `whatwg-ws-factory.ts`. Every case here mirrors a
 * scenario `WsRpcClient` actually depends on: a per-request socket that opens,
 * exchanges exactly one round trip, and closes - so the `onclose`/`onerror`
 * mapping (the brief's called-out risk) is proven against the real
 * `ws`/Node `net` close semantics, not an assumption.
 */

let servers: WebSocketServer[] = [];

function startServer(
  handler: (socket: import("ws").WebSocket) => void,
): { url: string; wss: WebSocketServer } {
  const wss = new WebSocketServer({ port: 0 });
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

function waitForOpen(socket: WebSocketLike): Promise<void> {
  return new Promise((resolve) => {
    socket.onopen = () => resolve();
  });
}

function waitForClose(socket: WebSocketLike): Promise<{
  code: number;
  reason: string;
  wasClean: boolean;
}> {
  return new Promise((resolve) => {
    socket.onclose = (event) => resolve(event);
  });
}

describe("createNodeWebSocketFactory (real ws server)", () => {
  it("opens and exchanges a text echo", async () => {
    const { url } = startServer((socket) => {
      socket.on("message", (data) => socket.send(data.toString()));
    });
    const factory = createNodeWebSocketFactory();
    const socket = factory.create(url);
    await waitForOpen(socket);

    const messageReceived = new Promise<string>((resolve) => {
      socket.onmessage = (event) => resolve(event.data);
    });
    socket.send("hello-from-adapter");
    await expect(messageReceived).resolves.toBe("hello-from-adapter");

    socket.close(1000, "done");
  });

  it("reports a clean local close with the exact code and reason", async () => {
    const { url } = startServer((socket) => {
      socket.on("message", () => {});
    });
    const factory = createNodeWebSocketFactory();
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
        socket.close(4001, "server says goodbye");
      });
    });
    const factory = createNodeWebSocketFactory();
    const socket = factory.create(url);
    await waitForOpen(socket);

    const closed = waitForClose(socket);
    socket.send("trigger-server-close");
    const event = await closed;

    expect(event.code).toBe(4001);
    expect(event.reason).toBe("server says goodbye");
    expect(event.wasClean).toBe(true);
  });

  it("fires onclose (not a hang) when the connection is refused", async () => {
    const factory = createNodeWebSocketFactory();
    // Port 1 is a reserved/unassigned TCP port on every platform this test
    // runs on, so nothing is listening - deterministic connection refusal
    // without depending on cleanup timing from another test.
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
});
