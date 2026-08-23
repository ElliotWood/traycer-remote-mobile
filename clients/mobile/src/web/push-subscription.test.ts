import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  base64UrlToBytes,
  ensurePushSubscription,
  PUSH_BASE_PATH,
  type PushFetch,
  type PushManagerLike,
  type PushRegistrationLike,
  type PushSubscriptionLike,
  type PushSubscriptionOutcome,
} from "./push-subscription";

/**
 * A REAL key produced by `web-push`'s `generateVAPIDKeys()`, kept verbatim.
 *
 * Not a hand-made string: the decoder's whole reason to exist is that a real
 * VAPID public key is 87 unpadded base64URL characters and may contain `-` and
 * `_`, and a fixture chosen for tidiness would exercise none of that. This one
 * carries both substituted characters and needs a pad byte.
 */
const REAL_VAPID_PUBLIC_KEY =
  "BIDOPsKF7HbBuIusVeXR1p9wyhUe3uXyVRZFczKDYyhi9z8FA6x1FIa_Sv-7WprKDvMLjU160aVRCQgs5xVDjhY";

const BEARER = "test-access-token";

interface FakeSubscription extends PushSubscriptionLike {
  readonly unsubscribe: Mock<() => Promise<boolean>>;
}

function fakeSubscription(options: {
  endpoint?: string;
  key?: Uint8Array | null;
  keys?: Record<string, string> | undefined;
}): FakeSubscription {
  const key = options.key === undefined ? base64UrlToBytes(REAL_VAPID_PUBLIC_KEY) : options.key;
  return {
    endpoint: options.endpoint ?? "https://push.example/endpoint/abc",
    options: {
      applicationServerKey:
        key === null
          ? null
          : (key.buffer.slice(
              key.byteOffset,
              key.byteOffset + key.byteLength,
            ) as ArrayBuffer),
    },
    toJSON: () => ({
      keys:
        options.keys === undefined
          ? { p256dh: "p256dh-value", auth: "auth-value" }
          : options.keys,
    }),
    unsubscribe: vi.fn(() => Promise.resolve(true)),
  };
}

interface FetchCall {
  readonly url: string;
  readonly init: RequestInit;
}

/**
 * The mocks are typed against the real signatures rather than bare `Mock`, so a
 * fake that drifts from `PushManagerLike` fails to compile instead of being
 * asserted into place.
 */
interface FakeManager extends PushManagerLike {
  readonly getSubscription: Mock<() => Promise<PushSubscriptionLike | null>>;
  readonly subscribe: Mock<
    (options: {
      userVisibleOnly: boolean;
      applicationServerKey: Uint8Array<ArrayBuffer>;
    }) => Promise<PushSubscriptionLike>
  >;
}

interface Harness {
  readonly calls: FetchCall[];
  readonly manager: FakeManager;
  readonly outcomes: PushSubscriptionOutcome[];
  run(): Promise<PushSubscriptionOutcome>;
}

interface HarnessOptions {
  readonly permission?: string;
  readonly isEmbedded?: boolean;
  readonly bearer?: string | null;
  readonly existing?: PushSubscriptionLike | null;
  readonly created?: PushSubscriptionLike;
  readonly subscribeRejects?: boolean;
  readonly noServiceWorker?: boolean;
  readonly noPushManager?: boolean;
  readonly readyRejects?: boolean;
  readonly vapidStatus?: number;
  readonly vapidBody?: unknown;
  readonly vapidThrows?: boolean;
  readonly subscribeStatus?: number;
}

function harness(options: HarnessOptions): Harness {
  const calls: FetchCall[] = [];
  const outcomes: PushSubscriptionOutcome[] = [];

  const created = options.created ?? fakeSubscription({});
  const manager: FakeManager = {
    getSubscription: vi.fn(() =>
      Promise.resolve<PushSubscriptionLike | null>(options.existing ?? null),
    ),
    subscribe: vi.fn(() =>
      options.subscribeRejects === true
        ? Promise.reject(new Error("no push provider"))
        : Promise.resolve(created),
    ),
  };

  const registration: PushRegistrationLike = {
    pushManager: options.noPushManager === true ? undefined : manager,
  };

  const doFetch: PushFetch = (url, init) => {
    calls.push({ url, init });
    if (url.endsWith("/vapid-public-key")) {
      if (options.vapidThrows === true) {
        return Promise.reject(new Error("network down"));
      }
      const status = options.vapidStatus ?? 200;
      const body =
        options.vapidBody === undefined
          ? { publicKey: REAL_VAPID_PUBLIC_KEY }
          : options.vapidBody;
      return Promise.resolve({
        ok: status >= 200 && status < 300,
        json: () => Promise.resolve(body),
      });
    }
    const status = options.subscribeStatus ?? 200;
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      json: () => Promise.resolve({}),
    });
  };

  return {
    calls,
    manager,
    outcomes,
    run: () =>
      ensurePushSubscription({
        serviceWorker:
          options.noServiceWorker === true
            ? undefined
            : {
                ready:
                  options.readyRejects === true
                    ? Promise.reject(new Error("registration forbidden"))
                    : Promise.resolve(registration),
              },
        getPermission: () => options.permission ?? "granted",
        // Defaults to NOT embedded, so every pre-existing case keeps asserting
        // about a top-level surface. The embedded arms opt in explicitly.
        isEmbedded: () => options.isEmbedded ?? false,
        getBearer: () =>
          Promise.resolve(options.bearer === undefined ? BEARER : options.bearer),
        fetch: doFetch,
        report: (outcome) => outcomes.push(outcome),
      }),
  };
}

afterEach(() => {
  delete document.documentElement.dataset.push;
});

describe("ensurePushSubscription", () => {
  it("subscribes and registers the subscription with the service", async () => {
    const h = harness({});
    await expect(h.run()).resolves.toBe("subscribed");

    // The whole object, not field-by-field: a dropped `userVisibleOnly` makes
    // Chrome reject the subscribe, and a per-field assertion only ever covers
    // the fields someone thought to name.
    expect(h.manager.subscribe.mock.calls).toEqual([
      [
        {
          userVisibleOnly: true,
          applicationServerKey: base64UrlToBytes(REAL_VAPID_PUBLIC_KEY),
        },
      ],
    ]);

    expect(h.calls.map((call) => call.url)).toEqual([
      `${PUSH_BASE_PATH}/vapid-public-key`,
      `${PUSH_BASE_PATH}/subscribe`,
    ]);
    expect(h.calls[0].init).toEqual({
      headers: { authorization: `Bearer ${BEARER}` },
    });
    // Whole init, including the serialized body, because the service parses
    // these exact bytes with a zod schema that rejects anything else.
    expect(h.calls[1].init).toEqual({
      method: "POST",
      headers: {
        authorization: `Bearer ${BEARER}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        endpoint: "https://push.example/endpoint/abc",
        keys: { p256dh: "p256dh-value", auth: "auth-value" },
      }),
    });
  });

  it("reuses a subscription whose key matches, and still upserts it", async () => {
    const existing = fakeSubscription({ endpoint: "https://push.example/kept" });
    const h = harness({ existing });

    await expect(h.run()).resolves.toBe("subscribed");
    expect(h.manager.subscribe).not.toHaveBeenCalled();
    expect(existing.unsubscribe).not.toHaveBeenCalled();
    // The upsert is the point: the browser can hold a live subscription the
    // service's store has lost, and nothing else in the system would notice.
    expect(h.calls[1].init?.body).toBe(
      JSON.stringify({
        endpoint: "https://push.example/kept",
        keys: { p256dh: "p256dh-value", auth: "auth-value" },
      }),
    );
  });

  it("replaces a subscription made against a different VAPID key", async () => {
    const stale = fakeSubscription({
      endpoint: "https://push.example/stale",
      key: new Uint8Array([1, 2, 3]),
    });
    const fresh = fakeSubscription({ endpoint: "https://push.example/fresh" });
    const h = harness({ existing: stale, created: fresh });

    await expect(h.run()).resolves.toBe("subscribed");
    expect(stale.unsubscribe).toHaveBeenCalledTimes(1);
    expect(h.manager.subscribe).toHaveBeenCalledTimes(1);
    expect(h.calls[1].init?.body).toContain("https://push.example/fresh");
  });

  it("replaces a subscription that carries no application server key at all", async () => {
    const keyless = fakeSubscription({ key: null });
    const h = harness({ existing: keyless });

    await expect(h.run()).resolves.toBe("subscribed");
    expect(keyless.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("does nothing at all without the notification grant", async () => {
    const h = harness({ permission: "default" });
    await expect(h.run()).resolves.toBe("permission");
    // Checked before the network: asking the service for its key would spend a
    // request to learn something the browser already refused.
    expect(h.calls).toEqual([]);
    expect(h.manager.subscribe).not.toHaveBeenCalled();
  });

  it("does not touch the browser's push service while signed out", async () => {
    const h = harness({ bearer: null });
    await expect(h.run()).resolves.toBe("signed-out");
    expect(h.calls).toEqual([]);
    expect(h.manager.getSubscription).not.toHaveBeenCalled();
    expect(h.manager.subscribe).not.toHaveBeenCalled();
  });

  it("reports an empty bearer as signed out rather than sending `Bearer `", async () => {
    const h = harness({ bearer: "" });
    await expect(h.run()).resolves.toBe("signed-out");
    expect(h.calls).toEqual([]);
  });

  it("reports unsupported where there is no service worker", async () => {
    const h = harness({ noServiceWorker: true });
    await expect(h.run()).resolves.toBe("unsupported");
    expect(h.calls).toEqual([]);
  });

  it("reports unsupported where the registration has no push manager", async () => {
    const h = harness({ noPushManager: true });
    await expect(h.run()).resolves.toBe("unsupported");
  });

  it("reports unsupported when registration itself is forbidden", async () => {
    const h = harness({ readyRejects: true });
    await expect(h.run()).resolves.toBe("unsupported");
  });

  it("reports unavailable when the service is not routed", async () => {
    const h = harness({ vapidStatus: 404 });
    await expect(h.run()).resolves.toBe("unavailable");
    // The 404 is the deployed-but-unrouted case, and it must not leave a
    // subscription behind that nobody can deliver to.
    expect(h.manager.subscribe).not.toHaveBeenCalled();
  });

  it("reports unavailable when the service refuses the bearer", async () => {
    const h = harness({ vapidStatus: 401 });
    await expect(h.run()).resolves.toBe("unavailable");
    expect(h.manager.subscribe).not.toHaveBeenCalled();
  });

  it("reports unavailable when the service is unreachable", async () => {
    const h = harness({ vapidThrows: true });
    await expect(h.run()).resolves.toBe("unavailable");
  });

  it("reports unavailable on a key-less response body", async () => {
    const h = harness({ vapidBody: { publicKey: "" } });
    await expect(h.run()).resolves.toBe("unavailable");
    expect(h.manager.subscribe).not.toHaveBeenCalled();
  });

  it("reports unavailable when the browser cannot reach its own push service", async () => {
    const h = harness({ subscribeRejects: true });
    await expect(h.run()).resolves.toBe("unavailable");
  });

  it("reports unavailable when the subscription carries no encryption keys", async () => {
    const h = harness({ created: fakeSubscription({ keys: {} }) });
    await expect(h.run()).resolves.toBe("unavailable");
    // Not posted: the service's schema would 400 it, and a 400 nobody reads is
    // a worse outcome than a reported one.
    expect(h.calls.map((call) => call.url)).toEqual([
      `${PUSH_BASE_PATH}/vapid-public-key`,
    ]);
  });

  it("reports unavailable when the service rejects the registration", async () => {
    const h = harness({ subscribeStatus: 400 });
    await expect(h.run()).resolves.toBe("unavailable");
  });

  it("stamps the outcome on <html data-push> by default", async () => {
    await ensurePushSubscription({
      serviceWorker: undefined,
      getPermission: () => "granted",
      getBearer: () => Promise.resolve(BEARER),
    });
    expect(document.documentElement.dataset.push).toBe("unsupported");
  });

  it("never throws — a failing report is still a boot-path call", async () => {
    const h = harness({});
    await expect(h.run()).resolves.toBe("subscribed");
    expect(h.outcomes).toEqual(["subscribed"]);
  });

  /**
   * The disclosed reduction, asserted rather than described. A rotated
   * subscription is repaired by the NEXT call, not by the worker — so calling
   * twice must be safe and must re-register, which is the whole mechanism the
   * docblock claims.
   */
  it("repairs a rotated subscription on the next call, which is the whole `pushsubscriptionchange` story", async () => {
    const rotated = fakeSubscription({
      endpoint: "https://push.example/rotated",
    });
    const h = harness({ existing: rotated });

    await expect(h.run()).resolves.toBe("subscribed");
    await expect(h.run()).resolves.toBe("subscribed");

    const posts = h.calls.filter((call) => call.url.endsWith("/subscribe"));
    expect(posts).toHaveLength(2);
    expect(posts.every((call) => call.init?.body?.toString().includes("rotated"))).toBe(true);
  });
});

/**
 * The embedded surface.
 *
 * The pair that matters is the first two: ONE permission reading, `denied`, and
 * two different outcomes depending only on the surface. Either test alone is
 * satisfiable by hardcoding — together they are not, which is the only reason
 * the surface is an injected seam rather than a read of `window.parent`.
 */
describe("ensurePushSubscription on a surface that refuses the grant", () => {
  it("reports surface-blocked when the denial belongs to the surface", async () => {
    const h = harness({ permission: "denied", isEmbedded: true });
    await expect(h.run()).resolves.toBe("surface-blocked");
    // Costs nothing: no request for the service's key, no subscribe attempt. The
    // outcome is a statement about where the app is running, and it is reached
    // without asserting anything a browser would have to confirm.
    expect(h.calls).toEqual([]);
    expect(h.manager.subscribe).not.toHaveBeenCalled();
  });

  it("keeps a TOP-LEVEL denial as `permission`, because that one is the user's", async () => {
    const h = harness({ permission: "denied", isEmbedded: false });
    await expect(h.run()).resolves.toBe("permission");
    expect(h.calls).toEqual([]);
  });

  /**
   * The MUT-P3 control. Keyed on the READING and not merely on the surface: an
   * embedded frame that somehow holds the grant must still subscribe. Without
   * this, widening the condition to "embedded" alone passes every other test
   * here while withholding push from a surface that honours it — the mistake
   * `embedding.ts` exists to prevent, in the module next door.
   */
  it("still subscribes in a frame that holds the grant", async () => {
    const h = harness({ permission: "granted", isEmbedded: true });
    await expect(h.run()).resolves.toBe("subscribed");
    expect(h.manager.subscribe).toHaveBeenCalled();
  });

  /**
   * The MUT-P4 control, and the assertion behind the docblock's reason for
   * mirroring `notification-permission.ts`'s condition rather than widening it.
   * On an embedder that leaves the permission at `default`, the notification
   * shell is still rendering a real Enable offer — so calling the surface
   * blocked here would contradict a banner the user is looking at.
   */
  it("leaves a `default` reading in a frame to the offer that is still showing", async () => {
    const h = harness({ permission: "default", isEmbedded: true });
    await expect(h.run()).resolves.toBe("permission");
  });

  it("stamps surface-blocked on <html data-push>, so the attribute is PRESENT", async () => {
    // The whole finding was an absent attribute, so the assertion is that a
    // reader of the deployed page sees a value at all — and the right one.
    await ensurePushSubscription({
      getPermission: () => "denied",
      isEmbedded: () => true,
    });
    expect(document.documentElement.dataset.push).toBe("surface-blocked");
  });
});

/**
 * The wiring in `main.tsx`, asserted against its SOURCE.
 *
 * Same device, and the same justification, as the ordering assertions in
 * `teams-theme-param.test.ts`: the defect this change fixes was not in any
 * module, it was one caller's early return, and nothing in a jsdom suite
 * executes `bootstrap()`. Every unit test above passed while the Teams tab
 * carried no `data-push` attribute at all, because they test the function and
 * the bug was in whether it is called.
 */
describe("the boot path drives push on every notification outcome", () => {
  const mainSource = readFileSync(
    join(process.cwd(), "src", "web", "main.tsx"),
    "utf8",
  );

  it("read the entry point it is asserting about", () => {
    // A wrong path throws above; this closes the found-but-empty case, so no
    // assertion below can pass by matching nothing.
    expect(mainSource.length).toBeGreaterThan(1000);
    expect(mainSource).toContain("ensurePushSubscription");
  });

  it("has no guard between the notification report and the push call", () => {
    // The deleted line, verbatim. It is cheap to re-add while "fixing" something
    // else, and re-adding it restores the absent attribute silently — no test
    // reddens, no error is logged, and the tab looks identical.
    expect(mainSource).not.toContain(`if (outcome !== "granted") return;`);
  });

  it("calls push inside the report hook rather than once at boot", () => {
    // Ordering, not presence. The hook fires both at load and on the Enable tap,
    // which is what subscribes a returning user AND a brand-new one; a single
    // call at boot would miss the tap, and a call only on the tap would miss
    // everyone who already granted.
    const hookStart = mainSource.indexOf("offerNotificationPermission({");
    const pushCall = mainSource.indexOf("ensurePushSubscription({");
    expect(hookStart).toBeGreaterThan(-1);
    expect(pushCall).toBeGreaterThan(hookStart);
  });
});

describe("base64UrlToBytes", () => {
  it("decodes a real 65-byte VAPID public key", () => {
    const bytes = base64UrlToBytes(REAL_VAPID_PUBLIC_KEY);
    expect(bytes).toHaveLength(65);
    // 0x04 is the uncompressed-point marker every P-256 VAPID key starts with.
    expect(bytes[0]).toBe(0x04);
  });

  it("decodes the base64URL alphabet rather than base64", () => {
    // The two substituted characters, decoded to the same bytes their standard
    // counterparts produce. Decoding `-`/`_` as themselves is the bug.
    expect([...base64UrlToBytes("-_8")]).toEqual([0xfb, 0xff]);
    expect([...base64UrlToBytes("+/8")]).toEqual([0xfb, 0xff]);
  });

  /**
   * The control for the whole module: the naive implementation, on the real
   * fixture, THROWS. Without this the decoder's tests would pass just as
   * happily against `atob` and prove nothing about why it exists.
   */
  it("succeeds on a real key that bare atob throws on", () => {
    expect(REAL_VAPID_PUBLIC_KEY).toHaveLength(87);
    expect(REAL_VAPID_PUBLIC_KEY).toMatch(/[-_]/);
    expect(() => atob(REAL_VAPID_PUBLIC_KEY)).toThrow();
    expect(base64UrlToBytes(REAL_VAPID_PUBLIC_KEY)).toHaveLength(65);
  });
});
