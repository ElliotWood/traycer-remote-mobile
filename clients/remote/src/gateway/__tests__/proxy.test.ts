import net from "node:net";
import http from "node:http";
import { writeFile, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, afterEach } from "vitest";
import { Registry } from "../registry";
import { attachProxy } from "../proxy";
import { startTunnelServer } from "../../agent/tunnel-server";
import type { GatewayConfig } from "../config";

const AGENT_TOKEN = "agent-shared-secret";
const AGENT_ID = "22222222-2222-2222-2222-222222222222";
const HOST_ID = "test-host-id";

async function listenEphemeral(server: net.Server | http.Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected an AddressInfo");
  }
  return address.port;
}

function baseConfig(overrides: Partial<GatewayConfig> = {}): GatewayConfig {
  return {
    publicListen: { host: "127.0.0.1", port: 0 },
    internalListen: { host: "127.0.0.1", port: 0 },
    devUpstream: null,
    staticDir: null,
    authnUpstream: "https://authn.example.invalid",
    pushUpstream: "http://127.0.0.1:1",
    publicScheme: "ws",
    publicHost: null,
    legacyLocalAgentId: AGENT_ID,
    agents: { [AGENT_ID]: { token: AGENT_TOKEN } },
    heartbeatTimeoutMs: 60_000,
    dialTimeoutMs: 1_000,
    ...overrides,
  };
}

describe("gateway proxy: /h/{hostId} routing, real end-to-end forwarding", () => {
  const cleanup: Array<() => void> = [];
  afterEach(() => {
    for (const fn of cleanup.splice(0)) fn();
  });

  async function setupFullChain(): Promise<{
    readonly gatewayPort: number;
    readonly registry: Registry;
    readonly received: Buffer[];
  }> {
    const received: Buffer[] = [];
    const fakeHost = net.createServer((socket) => {
      socket.on("data", (c: Buffer | string) =>
        received.push(typeof c === "string" ? Buffer.from(c) : c),
      );
    });
    const fakeHostPort = await listenEphemeral(fakeHost);
    cleanup.push(() => fakeHost.close());

    const tmpDir = await mkdtemp(join(tmpdir(), "traycer-remote-gw-test-"));
    const pidJsonPath = join(tmpDir, "pid.json");
    await writeFile(
      pidJsonPath,
      JSON.stringify({
        pid: 1,
        hostId: HOST_ID,
        version: "0.0.0-test",
        websocketUrl: `ws://127.0.0.1:${fakeHostPort}/rpc`,
        startedAt: new Date().toISOString(),
      }),
    );
    cleanup.push(() => void rm(tmpDir, { recursive: true, force: true }));

    const tunnel = startTunnelServer({
      host: "127.0.0.1",
      port: 0,
      token: AGENT_TOKEN,
      pidJsonPath: () => pidJsonPath,
    });
    const tunnelPort = await listenEphemeral(tunnel);
    cleanup.push(() => tunnel.close());

    const registry = new Registry(60_000);
    registry.upsert({
      agentId: AGENT_ID,
      hostId: HOST_ID,
      label: "test-agent",
      version: "0.0.0-test",
      reachableUrl: `http://127.0.0.1:${tunnelPort}`,
    });

    const config = baseConfig();
    const gatewayServer = http.createServer((_req, res) => {
      res.writeHead(404);
      res.end();
    });
    attachProxy(gatewayServer, { registry, config });
    const gatewayPort = await listenEphemeral(gatewayServer);
    cleanup.push(() => gatewayServer.close());

    return { gatewayPort, registry, received };
  }

  it("forwards through gateway -> agent -> host, preserving the http.Server upgrade event's `head` bytes", async () => {
    const { gatewayPort, received } = await setupFullChain();

    const client = net.connect(gatewayPort, "127.0.0.1");
    await new Promise<void>((resolve) => client.on("connect", resolve));
    cleanup.push(() => client.destroy());

    // A real WS frame the client sends immediately after the upgrade
    // request, in the SAME write - this is exactly what
    // `http.Server`'s `upgrade` event's third parameter (`head`) captures:
    // bytes the parser already read past the request head. If the gateway
    // doesn't forward `head` before piping, these bytes are silently lost.
    const immediateFrameBytes = Buffer.from("simulated-first-ws-frame-bytes", "utf8");
    const upgradeRequest =
      `GET /h/${HOST_ID}/rpc HTTP/1.1\r\n` +
      `Host: gateway.example.invalid\r\n` +
      `Upgrade: websocket\r\n` +
      `Connection: Upgrade\r\n` +
      `Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n` +
      `Sec-WebSocket-Version: 13\r\n` +
      `\r\n`;
    client.write(Buffer.concat([Buffer.from(upgradeRequest, "utf8"), immediateFrameBytes]));

    await new Promise<void>((resolve, reject) => {
      const start = Date.now();
      const interval = setInterval(() => {
        const all = Buffer.concat(received);
        if (all.includes(immediateFrameBytes)) {
          clearInterval(interval);
          resolve();
          return;
        }
        if (Date.now() - start > 4_000) {
          clearInterval(interval);
          reject(new Error(`timed out; received so far: ${Buffer.concat(received).toString("utf8")}`));
        }
      }, 50);
    });

    const all = Buffer.concat(received);
    const headEnd = all.indexOf("\r\n\r\n") + 4;
    const forwardedHead = all.subarray(0, headEnd).toString("utf8");

    // Hop-termination + no-leak assertions on what the HOST actually saw.
    expect(forwardedHead).toContain("Host: 127.0.0.1:");
    expect(forwardedHead).not.toContain("gateway.example.invalid");
    expect(forwardedHead).not.toContain("X-Traycer-Agent-Token");
    expect(forwardedHead).not.toContain(AGENT_TOKEN);
    // Node's `req.headers` normalizes header names to lowercase - correct
    // per HTTP's case-insensitivity, so this asserts case-insensitively
    // rather than assuming the original casing survives.
    expect(forwardedHead.toLowerCase()).toContain(
      "sec-websocket-key: dGhlIHNhbXBsZSBub25jZQ==".toLowerCase(),
    );

    // The immediate frame bytes (the `head` parameter) arrived intact.
    expect(all.subarray(headEnd).equals(immediateFrameBytes)).toBe(true);
  });

  it("unknown hostId: 404 HOST_UNKNOWN, JSON, before any upgrade", async () => {
    const { gatewayPort } = await setupFullChain();
    const res = await httpProbe(gatewayPort, "/h/does-not-exist/rpc");
    expect(res.status).toBe(404);
    expect(res.contentType).toContain("application/json");
    expect(JSON.parse(res.body)).toEqual({ error: "HOST_UNKNOWN", hostId: "does-not-exist" });
  });

  it("offline hostId (heartbeat lapsed): 503 HOST_OFFLINE, JSON", async () => {
    const { gatewayPort, registry } = await setupFullChain();
    // Force the entry unavailable without waiting out a real timeout.
    registry.markStopped(AGENT_ID);

    const res = await httpProbe(gatewayPort, `/h/${HOST_ID}/rpc`);
    expect(res.status).toBe(503);
    expect(res.contentType).toContain("application/json");
    expect(JSON.parse(res.body)).toEqual({ error: "HOST_OFFLINE", hostId: HOST_ID });
  });

  it("empty registry: GET /hosts-equivalent path check - unknown hostId still 404s cleanly, not a hang", async () => {
    const received: Buffer[] = [];
    const fakeHost = net.createServer((s) => s.on("data", (c) => received.push(c as Buffer)));
    cleanup.push(() => fakeHost.close());
    const registry = new Registry(60_000); // nothing registered
    const config = baseConfig();
    const gatewayServer = http.createServer((_req, res) => res.end());
    attachProxy(gatewayServer, { registry, config });
    const gatewayPort = await listenEphemeral(gatewayServer);
    cleanup.push(() => gatewayServer.close());

    const res = await httpProbe(gatewayPort, "/h/anything/rpc");
    expect(res.status).toBe(404);
  });
});

/** Sends a raw upgrade request that we EXPECT to be rejected pre-upgrade
 * (plain HTTP response, not a 101), and reads the full response. */
async function httpProbe(
  port: number,
  path: string,
): Promise<{ readonly status: number; readonly contentType: string; readonly body: string }> {
  const client = net.connect(port, "127.0.0.1");
  await new Promise<void>((resolve) => client.on("connect", resolve));
  client.write(
    `GET ${path} HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`,
  );
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve) => {
    client.on("data", (c: Buffer) => chunks.push(c));
    client.on("end", resolve);
    client.on("close", resolve);
  });
  client.destroy();
  const raw = Buffer.concat(chunks).toString("utf8");
  const statusMatch = /^HTTP\/1\.\d (\d+)/.exec(raw);
  const contentTypeMatch = /Content-Type:\s*([^\r\n]+)/i.exec(raw);
  const body = raw.slice(raw.indexOf("\r\n\r\n") + 4);
  return {
    status: statusMatch ? Number.parseInt(statusMatch[1], 10) : 0,
    contentType: contentTypeMatch?.[1] ?? "",
    body,
  };
}
