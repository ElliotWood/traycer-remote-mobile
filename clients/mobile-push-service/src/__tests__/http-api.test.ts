import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHttpApiServer } from "../http-api";
import { SubscriptionStore } from "../subscription-store";

let dir: string;
let store: SubscriptionStore;
let server: ReturnType<typeof createHttpApiServer>;
let baseUrl: string;

const VALID_TOKEN = "valid-token";
const VAPID_PUBLIC_KEY = "test-vapid-public-key";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "push-service-http-"));
  store = new SubscriptionStore(join(dir, "subscriptions.json"));
  await store.load();
  server = createHttpApiServer({
    vapidPublicKey: VAPID_PUBLIC_KEY,
    subscriptionStore: store,
    validateBearer: async (token) => token === VALID_TOKEN,
    now: () => 1_700_000_000_000,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(dir, { recursive: true, force: true });
});

function authHeader(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

describe("GET /vapid-public-key", () => {
  it("401s with no Authorization header", async () => {
    const res = await fetch(`${baseUrl}/vapid-public-key`);
    expect(res.status).toBe(401);
  });

  it("401s with an invalid bearer", async () => {
    const res = await fetch(`${baseUrl}/vapid-public-key`, { headers: authHeader("garbage") });
    expect(res.status).toBe(401);
  });

  it("200s with the public key only — never the private key — for a valid bearer", async () => {
    const res = await fetch(`${baseUrl}/vapid-public-key`, { headers: authHeader(VALID_TOKEN) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ publicKey: VAPID_PUBLIC_KEY });
    expect(Object.keys(body)).not.toContain("privateKey");
  });

  it("404s on the prefixed path — the server is mounted prefix-free, tailscale serve strips /push before proxying", async () => {
    const res = await fetch(`${baseUrl}/push/vapid-public-key`, { headers: authHeader(VALID_TOKEN) });
    expect(res.status).toBe(404);
  });
});

describe("POST /subscribe", () => {
  it("401s with no Authorization header", async () => {
    const res = await fetch(`${baseUrl}/subscribe`, { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("400s on a malformed body", async () => {
    const res = await fetch(`${baseUrl}/subscribe`, {
      method: "POST",
      headers: { ...authHeader(VALID_TOKEN), "Content-Type": "application/json" },
      body: JSON.stringify({ nope: true }),
    });
    expect(res.status).toBe(400);
  });

  it("upserts a new subscription", async () => {
    const res = await fetch(`${baseUrl}/subscribe`, {
      method: "POST",
      headers: { ...authHeader(VALID_TOKEN), "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: "https://fcm.example/a", keys: { p256dh: "p", auth: "a" } }),
    });
    expect(res.status).toBe(200);
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0].endpoint).toBe("https://fcm.example/a");
  });

  it("dedupes by endpoint — subscribing the same endpoint twice never duplicates", async () => {
    const body = JSON.stringify({ endpoint: "https://fcm.example/a", keys: { p256dh: "p", auth: "a" } });
    for (let i = 0; i < 2; i += 1) {
      const res = await fetch(`${baseUrl}/subscribe`, {
        method: "POST",
        headers: { ...authHeader(VALID_TOKEN), "Content-Type": "application/json" },
        body,
      });
      expect(res.status).toBe(200);
    }
    expect(store.list()).toHaveLength(1);
  });
});

describe("POST /unsubscribe", () => {
  it("401s with no Authorization header", async () => {
    const res = await fetch(`${baseUrl}/unsubscribe`, { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("removes a registered subscription", async () => {
    await store.upsert("https://fcm.example/a", { p256dh: "p", auth: "a" }, Date.now());
    const res = await fetch(`${baseUrl}/unsubscribe`, {
      method: "POST",
      headers: { ...authHeader(VALID_TOKEN), "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: "https://fcm.example/a" }),
    });
    expect(res.status).toBe(200);
    expect(store.list()).toHaveLength(0);
  });

  it("200s idempotently for an endpoint that was never registered", async () => {
    const res = await fetch(`${baseUrl}/unsubscribe`, {
      method: "POST",
      headers: { ...authHeader(VALID_TOKEN), "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: "https://fcm.example/never-existed" }),
    });
    expect(res.status).toBe(200);
  });
});
