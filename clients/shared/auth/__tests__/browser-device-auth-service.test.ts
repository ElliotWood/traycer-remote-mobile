/**
 * `MobileAuthService` — sessionStorage rehydrate → revalidate → sign-out
 * branches, plus the `revalidateCurrentContext` recovery contract, over a mocked
 * `fetch`. The device-flow poll loop is pinned separately in `device-flow.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MobileAuthService,
  type StorageLike,
} from "../browser-device-auth-service";

const AUTHN_BASE_URL = "https://authn.example.test";
const STORAGE_KEY = "traycer.mobile.auth";

// A schema-valid `/api/v3/user` wire body (matching the gui-app auth-service
// suite's fixture — Dates as ISO strings, nullable fields present).
function userBody(userId: string): unknown {
  return {
    user: {
      id: userId,
      name: `${userId} display`,
      providerId: `gh-${userId}`,
      providerHandle: userId,
      providerType: "GITHUB",
      email: `${userId}@example.com`,
      avatarUrl: null,
      activatedAt: null,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
      lastSeenAt: null,
      privacyMode: false,
      isLearningEnabled: true,
    },
    userSubscription: {
      id: `sub-${userId}`,
      userID: userId,
      orgID: null,
      teamID: null,
      customerId: `cus-${userId}`,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
      subscriptionExpiry: null,
      trialEndsAt: null,
      subscriptionStatus: "FREE",
      hasPaymentMethod: false,
      isInTrial: false,
      rechargeRateSeconds: 0,
    },
    teamSubscriptions: [],
    payAsYouGoUsage: { allowPayAsYouGo: false },
  };
}

interface Spec {
  readonly status: number;
  readonly body: unknown;
}

let originalFetch: typeof globalThis.fetch;
let counts: Record<string, number>;

function installRouter(routes: Record<string, Spec[]>): void {
  const cursors: Record<string, number> = {};
  counts = {};
  globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const key = Object.keys(routes).find((candidate) => url.includes(candidate));
    if (key === undefined) {
      throw new Error(`unexpected fetch to ${url}`);
    }
    counts[key] = (counts[key] ?? 0) + 1;
    const specs = routes[key];
    const index = cursors[key] ?? 0;
    const spec = specs[Math.min(index, specs.length - 1)];
    cursors[key] = index + 1;
    return new Response(JSON.stringify(spec.body), {
      status: spec.status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

class MemoryStorage implements StorageLike {
  private readonly map = new Map<string, string>();

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  seed(tokens: { token: string; refreshToken: string }): void {
    this.map.set(STORAGE_KEY, JSON.stringify(tokens));
  }
  raw(): string | null {
    return this.map.get(STORAGE_KEY) ?? null;
  }
}

function makeService(storage: StorageLike): MobileAuthService {
  return new MobileAuthService({ authnBaseUrl: AUTHN_BASE_URL, storage });
}

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("start() rehydration", () => {
  it("stays signed-out with no persisted tokens", async () => {
    installRouter({});
    const service = makeService(new MemoryStorage());

    await service.start();

    expect(service.status()).toEqual({ kind: "signed-out", error: null });
    expect(service.current()).toBeNull();
    expect(service.bearerSource()).toBeNull();
  });

  it("mints a context when the stored access token validates", async () => {
    installRouter({ "/api/v3/user": [{ status: 200, body: userBody("u1") }] });
    const storage = new MemoryStorage();
    storage.seed({ token: "acc-1", refreshToken: "ref-1" });
    const service = makeService(storage);

    await service.start();

    expect(service.status().kind).toBe("signed-in");
    const ctx = service.current();
    expect(ctx).not.toBeNull();
    expect(ctx?.identity.userId).toBe("u1");
    expect(service.bearerSource()?.getBearerToken()).toBe("acc-1");
  });

  it("refreshes when the stored access token is stale, then signs in", async () => {
    installRouter({
      "/api/v3/user": [
        { status: 401, body: {} }, // stale access token
        { status: 200, body: userBody("u1") }, // re-validate the rotated bearer
      ],
      "auth/refresh": [
        { status: 200, body: { token: "acc-2", refreshToken: "ref-2" } },
      ],
    });
    const storage = new MemoryStorage();
    storage.seed({ token: "acc-1", refreshToken: "ref-1" });
    const service = makeService(storage);

    await service.start();

    expect(service.status().kind).toBe("signed-in");
    expect(service.bearerSource()?.getBearerToken()).toBe("acc-2");
    expect(storage.raw()).toBe(
      JSON.stringify({ token: "acc-2", refreshToken: "ref-2" }),
    );
  });

  it("signs out and clears storage when the refresh token is dead", async () => {
    installRouter({
      "/api/v3/user": [{ status: 401, body: {} }],
      "auth/refresh": [{ status: 401, body: {} }],
    });
    const storage = new MemoryStorage();
    storage.seed({ token: "acc-1", refreshToken: "ref-1" });
    const service = makeService(storage);

    await service.start();

    expect(service.status()).toEqual({
      kind: "signed-out",
      error: "session-expired",
    });
    expect(service.current()).toBeNull();
    expect(storage.raw()).toBeNull();
  });

  it("keeps the stored pair on a transient network error", async () => {
    // 500 → network-error (validate retries then gives up); no refresh attempted.
    installRouter({ "/api/v3/user": [{ status: 500, body: {} }] });
    const storage = new MemoryStorage();
    storage.seed({ token: "acc-1", refreshToken: "ref-1" });
    const service = makeService(storage);

    await service.start();

    expect(service.status()).toEqual({ kind: "signed-out", error: null });
    expect(service.current()).toBeNull();
    // Retained for a later reload.
    expect(storage.raw()).toBe(
      JSON.stringify({ token: "acc-1", refreshToken: "ref-1" }),
    );
  });
});

describe("revalidateCurrentContext()", () => {
  async function signedInService(): Promise<{
    service: MobileAuthService;
    storage: MemoryStorage;
  }> {
    installRouter({ "/api/v3/user": [{ status: 200, body: userBody("u1") }] });
    const storage = new MemoryStorage();
    storage.seed({ token: "acc-1", refreshToken: "ref-1" });
    const service = makeService(storage);
    await service.start();
    return { service, storage };
  }

  it("returns null when signed out", async () => {
    installRouter({});
    const service = makeService(new MemoryStorage());

    expect(await service.revalidateCurrentContext()).toBeNull();
  });

  it("returns valid and leaves the session intact when the bearer still validates", async () => {
    const { service } = await signedInService();
    installRouter({ "/api/v3/user": [{ status: 200, body: userBody("u1") }] });
    const ctxBefore = service.current();

    const outcome = await service.revalidateCurrentContext();

    expect(outcome?.kind).toBe("valid");
    expect(service.current()).toBe(ctxBefore);
    expect(service.bearerSource()?.getBearerToken()).toBe("acc-1");
  });

  it("rotates the lease in place when a stale bearer refreshes", async () => {
    const { service, storage } = await signedInService();
    installRouter({
      "/api/v3/user": [
        { status: 401, body: {} },
        { status: 200, body: userBody("u1") },
      ],
      "auth/refresh": [
        { status: 200, body: { token: "acc-2", refreshToken: "ref-2" } },
      ],
    });
    const ctxBefore = service.current();

    const outcome = await service.revalidateCurrentContext();

    expect(outcome?.kind).toBe("valid");
    // Same-user rotation: the context reference is unchanged (silent on onChange).
    expect(service.current()).toBe(ctxBefore);
    expect(service.bearerSource()?.getBearerToken()).toBe("acc-2");
    expect(storage.raw()).toBe(
      JSON.stringify({ token: "acc-2", refreshToken: "ref-2" }),
    );
  });

  it("signs out and returns rejected when the refresh token is dead", async () => {
    const { service, storage } = await signedInService();
    installRouter({
      "/api/v3/user": [{ status: 401, body: {} }],
      "auth/refresh": [{ status: 401, body: {} }],
    });

    const outcome = await service.revalidateCurrentContext();

    expect(outcome).toEqual({ kind: "rejected" });
    expect(service.current()).toBeNull();
    expect(service.status().kind).toBe("signed-out");
    expect(storage.raw()).toBeNull();
  });

  it("single-flights concurrent revalidations onto one refresh spend", async () => {
    const { service } = await signedInService();
    installRouter({
      "/api/v3/user": [
        { status: 401, body: {} },
        { status: 200, body: userBody("u1") },
      ],
      "auth/refresh": [
        { status: 200, body: { token: "acc-2", refreshToken: "ref-2" } },
      ],
    });

    const [a, b] = await Promise.all([
      service.revalidateCurrentContext(),
      service.revalidateCurrentContext(),
    ]);

    expect(a?.kind).toBe("valid");
    expect(b?.kind).toBe("valid");
    // The single-use refresh token was spent exactly once.
    expect(counts["auth/refresh"]).toBe(1);
  });
});

describe("signOut()", () => {
  it("aborts the context and clears storage", async () => {
    installRouter({ "/api/v3/user": [{ status: 200, body: userBody("u1") }] });
    const storage = new MemoryStorage();
    storage.seed({ token: "acc-1", refreshToken: "ref-1" });
    const service = makeService(storage);
    await service.start();
    expect(service.current()).not.toBeNull();

    service.signOut();

    expect(service.current()).toBeNull();
    expect(service.bearerSource()).toBeNull();
    expect(service.status()).toEqual({ kind: "signed-out", error: null });
    expect(storage.raw()).toBeNull();
  });
});
