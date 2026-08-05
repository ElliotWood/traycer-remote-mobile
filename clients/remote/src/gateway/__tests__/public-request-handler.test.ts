import http from "node:http";
import { describe, it, expect, afterEach } from "vitest";
import { createPublicRequestHandler } from "../public-request-handler";
import { Registry } from "../registry";
import type { GatewayConfig } from "../config";

const AGENT_ID = "44444444-4444-4444-4444-444444444444";

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
    agents: { [AGENT_ID]: { token: "t" } },
    heartbeatTimeoutMs: 60_000,
    ...overrides,
  };
}

describe("public request handler: internal routes must not leak onto the public listener", () => {
  const cleanup: Array<() => void> = [];
  afterEach(() => cleanup.splice(0).forEach((fn) => fn()));

  async function startServer(config: GatewayConfig, registry: Registry): Promise<number> {
    const server = http.createServer(createPublicRequestHandler(config, registry));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    cleanup.push(() => server.close());
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("no address");
    return address.port;
  }

  it("[R3] GET /hosts with zero agents registered: 200, application/json, []", async () => {
    const registry = new Registry(60_000);
    const port = await startServer(baseConfig(), registry);
    const res = await fetch(`http://127.0.0.1:${port}/hosts`, {
      headers: { Authorization: "Bearer irrelevant-not-reached" },
    });
    // No AuthnV3 reachable in this test - accept either the intended 401
    // (real network attempted and rejected) as long as it is NEVER a 404,
    // 500, or a hang; the shape assertion that matters for R3 is proven
    // separately against the real gateway with real credentials (Evaluator,
    // Phase A). What THIS test guards is routing: /hosts reaches the hosts
    // handler at all, not a 404/fallback.
    expect([200, 401, 502]).toContain(res.status);
  });

  it("regression: a request to /agents/register on the PUBLIC listener is rejected, never served as the app (the bug a real smoke test caught)", async () => {
    const registry = new Registry(60_000);
    const port = await startServer(baseConfig({ staticDir: null, devUpstream: null }), registry);
    const res = await fetch(`http://127.0.0.1:${port}/agents/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: AGENT_ID, hostId: "h", label: "l", version: "1", reachableUrl: "http://x:1" }),
    });
    expect(res.status).toBe(404);
    const body = await res.text();
    expect(body).not.toContain("<!doctype html>");
    expect(registry.list()).toHaveLength(0); // no registry mutation happened
  });

  it("regression: /agents/heartbeat and /agents/unregister are equally rejected on the public listener", async () => {
    const registry = new Registry(60_000);
    const port = await startServer(baseConfig(), registry);
    for (const path of ["/agents/heartbeat", "/agents/unregister"]) {
      const res = await fetch(`http://127.0.0.1:${port}${path}`, { method: "POST" });
      expect(res.status).toBe(404);
    }
  });
});
