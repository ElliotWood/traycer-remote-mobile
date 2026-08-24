import net from "node:net";
import { writeFile, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, afterEach } from "vitest";
import { startTunnelServer } from "../tunnel-server";
import { rewriteHeadForLoopback } from "../loopback-forward";

const TOKEN = "test-token-abc";

async function listenEphemeral(server: net.Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected an AddressInfo");
  }
  return address.port;
}

describe("tunnel-server: no bytes dropped across the async pid.json-read gap", () => {
  const cleanup: Array<() => void> = [];

  afterEach(() => {
    for (const fn of cleanup.splice(0)) fn();
  });

  it("forwards a request whose head and body arrive as separate TCP chunks, byte-identical", async () => {
    // Fake loopback "host": records every byte it receives, raw.
    const received: Buffer[] = [];
    const fakeHost = net.createServer((socket) => {
      socket.on("data", (chunk: Buffer | string) =>
        received.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk),
      );
    });
    const fakeHostPort = await listenEphemeral(fakeHost);
    cleanup.push(() => fakeHost.close());

    const tmpDir = await mkdtemp(join(tmpdir(), "traycer-remote-test-"));
    const pidJsonPath = join(tmpDir, "pid.json");
    await writeFile(
      pidJsonPath,
      JSON.stringify({
        pid: 1,
        hostId: "test-host-id",
        version: "0.0.0-test",
        websocketUrl: `ws://127.0.0.1:${fakeHostPort}/rpc`,
        startedAt: new Date().toISOString(),
      }),
    );
    cleanup.push(() => void rm(tmpDir, { recursive: true, force: true }));

    const events: unknown[] = [];
    const tunnel = startTunnelServer({
      host: "127.0.0.1",
      port: 0,
      token: TOKEN,
      pidJsonPath: () => pidJsonPath,
      onEvent: (e) => events.push(e),
    });
    const tunnelPort = await listenEphemeral(tunnel);
    cleanup.push(() => tunnel.close());

    const client = net.connect(tunnelPort, "127.0.0.1");
    await new Promise<void>((resolve) => client.on("connect", resolve));
    cleanup.push(() => client.destroy());

    // Body payload comfortably over a single TCP segment / the head-buffer
    // guard, so this doubles as R4's large-payload check.
    const body = Buffer.alloc(200_000, 0x61); // 200KB of 'a'
    const head =
      `GET /rpc HTTP/1.1\r\n` +
      // Deliberately NOT the real staging FQDN (kept generic even in test
      // fixtures) - what matters is that this arrives as a public, non-
      // loopback Host/Origin the rewrite must replace.
      `Host: example-client-origin.example.ts.net:8443\r\n` +
      `Origin: https://example-client-origin.example.ts.net:8443\r\n` +
      `X-Traycer-Agent-Token: ${TOKEN}\r\n` +
      `Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n` +
      `Sec-WebSocket-Version: 13\r\n` +
      `Upgrade: websocket\r\n` +
      `Connection: Upgrade\r\n` +
      `\r\n`;

    // Write the head first, then the body as a SEPARATE write - separate
    // TCP chunks, with the tunnel server's async pid.json read happening in
    // between. Deterministic (not timing-dependent): the server's `data`
    // handler for the head chunk runs synchronously through `client.pause()`
    // before its first `await`, so Node cannot deliver the body chunk's
    // `data` event until that pause has already taken effect - regression
    // test for the dropped-bytes bug the async gap introduced.
    client.write(head, "utf8");
    client.write(body);

    // Wait for the fake host to have received everything: the REWRITTEN
    // head (shorter than the original - "127.0.0.1:<port>" is shorter than
    // the tailnet FQDN it replaces) + the full body. Polled, not
    // event-driven, so there is no race between the connection happening
    // and a listener being attached in time to observe it.
    const rewrittenHead = rewriteHeadForLoopback(head, fakeHostPort);
    const expectedBytes =
      Buffer.byteLength(rewrittenHead, "utf8") + body.length;
    await new Promise<void>((resolve, reject) => {
      const start = Date.now();
      const interval = setInterval(() => {
        const total = received.reduce((sum, b) => sum + b.length, 0);
        if (total >= expectedBytes) {
          clearInterval(interval);
          resolve();
          return;
        }
        if (Date.now() - start > 4_000) {
          clearInterval(interval);
          reject(
            new Error(
              `timed out waiting for forwarded bytes (got ${total}, want ${expectedBytes}); events=${JSON.stringify(events)}`,
            ),
          );
        }
      }, 50);
    });

    const all = Buffer.concat(received);
    expect(all.length).toBe(expectedBytes);

    // Head arrives rewritten to loopback; body arrives byte-identical.
    const forwardedHead = all
      .subarray(0, all.indexOf("\r\n\r\n") + 4)
      .toString("utf8");
    expect(forwardedHead).toContain(`Host: 127.0.0.1:${fakeHostPort}`);
    expect(forwardedHead).toContain(`Origin: http://127.0.0.1:${fakeHostPort}`);
    // The WS handshake fields survive untouched end-to-end...
    expect(forwardedHead).toContain(
      "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
    );
    // ...but the internal hop-auth token is stripped - the loopback host has
    // no business ever seeing it.
    expect(forwardedHead).not.toContain("X-Traycer-Agent-Token");
    expect(forwardedHead).not.toContain(TOKEN);

    const forwardedBody = all.subarray(all.indexOf("\r\n\r\n") + 4);
    expect(forwardedBody.equals(body)).toBe(true);

    expect(
      events.some((e) => (e as { kind: string }).kind === "forwarded"),
    ).toBe(true);
  });

  it("rejects a missing/wrong bearer before any bytes reach the loopback host", async () => {
    const received: Buffer[] = [];
    const fakeHost = net.createServer((socket) => {
      socket.on("data", (chunk: Buffer | string) =>
        received.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk),
      );
    });
    const fakeHostPort = await listenEphemeral(fakeHost);
    cleanup.push(() => fakeHost.close());

    const tmpDir = await mkdtemp(join(tmpdir(), "traycer-remote-test-"));
    const pidJsonPath = join(tmpDir, "pid.json");
    await writeFile(
      pidJsonPath,
      JSON.stringify({
        pid: 1,
        hostId: "test-host-id",
        version: "0.0.0-test",
        websocketUrl: `ws://127.0.0.1:${fakeHostPort}/rpc`,
        startedAt: new Date().toISOString(),
      }),
    );
    cleanup.push(() => void rm(tmpDir, { recursive: true, force: true }));

    const tunnel = startTunnelServer({
      host: "127.0.0.1",
      port: 0,
      token: TOKEN,
      pidJsonPath: () => pidJsonPath,
    });
    const tunnelPort = await listenEphemeral(tunnel);
    cleanup.push(() => tunnel.close());

    const client = net.connect(tunnelPort, "127.0.0.1");
    await new Promise<void>((resolve) => client.on("connect", resolve));
    cleanup.push(() => client.destroy());

    const responseChunks: Buffer[] = [];
    client.on("data", (c: Buffer | string) =>
      responseChunks.push(typeof c === "string" ? Buffer.from(c) : c),
    );

    client.write(
      `GET /rpc HTTP/1.1\r\nHost: x\r\nX-Traycer-Agent-Token: wrong-token\r\n\r\n`,
    );

    await new Promise<void>((resolve) => client.on("end", resolve));
    const response = Buffer.concat(responseChunks).toString("utf8");
    expect(response).toContain("401");
    expect(received.length).toBe(0);
  });
});
