import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createPushSender,
  type PushPayload,
  type SendNotificationFn,
} from "../push-sender";
import { SubscriptionStore } from "../subscription-store";

/**
 * These cases are about delivery and pruning, not about content — one shared
 * payload keeps them from drifting apart, and keeps a payload-shape change
 * from having to be applied five times. `payload: null` is the routeless
 * summary shape, which is a real thing this sender sends.
 */
const PAYLOAD: PushPayload = {
  title: "t",
  body: "b",
  payload: null,
  replaceKey: "host:id:t",
};

const VAPID_KEYS = {
  publicKey: "test-public-key",
  privateKey: "test-private-key-must-never-appear-in-a-log-or-response",
  subject: "mailto:push@traycer.ai",
};

/** Shaped like the real `WebPushError` a `web-push` send throws on rejection — `.statusCode`/`.headers`/`.body`/`.endpoint` — without depending on its exact constructor signature. */
function webPushErrorShape(statusCode: number, endpoint: string): Error & {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  endpoint: string;
} {
  return Object.assign(new Error(`push service responded ${statusCode}`), {
    statusCode,
    headers: {},
    body: "",
    endpoint,
  });
}

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "push-service-sender-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Fresh temp-file-backed store per call — never the real `~/.traycer/push-service/subscriptions.json`. */
async function storeWith(
  endpoints: readonly string[],
): Promise<SubscriptionStore> {
  const store = new SubscriptionStore(join(dir, "subscriptions.json"));
  await store.load();
  for (const endpoint of endpoints) {
    await store.upsert(endpoint, { p256dh: "p", auth: "a" }, Date.now());
  }
  return store;
}

describe("push sender — prune on error", () => {
  it("prunes the subscription on a 410 Gone", async () => {
    const store = await storeWith(["https://fcm.example/dead"]);
    const send: SendNotificationFn = async (sub) => {
      throw webPushErrorShape(410, sub.endpoint);
    };
    const sender = createPushSender({ vapidKeys: VAPID_KEYS, subscriptionStore: store, send });

    await sender.sendToAll(PAYLOAD);

    expect(store.list()).toHaveLength(0);
  });

  it("prunes the subscription on a 404 Not Found", async () => {
    const store = await storeWith(["https://fcm.example/gone"]);
    const send: SendNotificationFn = async (sub) => {
      throw webPushErrorShape(404, sub.endpoint);
    };
    const sender = createPushSender({ vapidKeys: VAPID_KEYS, subscriptionStore: store, send });

    await sender.sendToAll(PAYLOAD);

    expect(store.list()).toHaveLength(0);
  });

  it("does NOT prune on any other status code (e.g. a transient 500)", async () => {
    const store = await storeWith(["https://fcm.example/flaky"]);
    const send: SendNotificationFn = async (sub) => {
      throw webPushErrorShape(500, sub.endpoint);
    };
    const sender = createPushSender({ vapidKeys: VAPID_KEYS, subscriptionStore: store, send });

    await sender.sendToAll(PAYLOAD);

    expect(store.list()).toHaveLength(1);
  });

  it("leaves other subscriptions untouched when only one fails", async () => {
    const store = await storeWith(["https://fcm.example/dead", "https://fcm.example/alive"]);
    const send: SendNotificationFn = async (sub) => {
      if (sub.endpoint.endsWith("/dead")) {
        throw webPushErrorShape(410, sub.endpoint);
      }
    };
    const sender = createPushSender({ vapidKeys: VAPID_KEYS, subscriptionStore: store, send });

    await sender.sendToAll(PAYLOAD);

    const remaining = store.list();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].endpoint).toBe("https://fcm.example/alive");
  });

  it("sends the exact vapid subject/keys through to the send function", async () => {
    const store = await storeWith(["https://fcm.example/one"]);
    let seenVapid: unknown = null;
    const send: SendNotificationFn = async (_sub, _payload, options) => {
      seenVapid = options.vapidDetails;
    };
    const sender = createPushSender({ vapidKeys: VAPID_KEYS, subscriptionStore: store, send });

    await sender.sendToAll(PAYLOAD);

    expect(seenVapid).toEqual(VAPID_KEYS);
  });
});
