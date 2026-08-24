import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SubscriptionStore } from "../subscription-store";

let dir: string;
let path: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "push-service-subs-"));
  path = join(dir, "subscriptions.json");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("SubscriptionStore", () => {
  it("starts empty when no file exists", async () => {
    const store = new SubscriptionStore(path);
    await store.load();
    expect(store.list()).toEqual([]);
  });

  it("persists across a fresh load against the same path (simulated restart)", async () => {
    const first = new SubscriptionStore(path);
    await first.load();
    await first.upsert(
      "https://fcm.example/a",
      { p256dh: "p", auth: "a" },
      1_000,
    );

    const second = new SubscriptionStore(path);
    await second.load();
    expect(second.list()).toEqual(first.list());
  });

  it("upsert refreshes subscribedAt without duplicating", async () => {
    const store = new SubscriptionStore(path);
    await store.load();
    await store.upsert(
      "https://fcm.example/a",
      { p256dh: "p", auth: "a" },
      1_000,
    );
    await store.upsert(
      "https://fcm.example/a",
      { p256dh: "p2", auth: "a2" },
      2_000,
    );
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0]).toEqual({
      endpoint: "https://fcm.example/a",
      keys: { p256dh: "p2", auth: "a2" },
      subscribedAt: 2_000,
    });
  });

  it("remove is idempotent for an absent endpoint", async () => {
    const store = new SubscriptionStore(path);
    await store.load();
    await store.remove("https://fcm.example/never-existed");
    expect(store.list()).toEqual([]);
  });
});
