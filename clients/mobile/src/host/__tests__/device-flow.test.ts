/**
 * Device-flow poll-state mapping (`runDeviceAuthorization`).
 *
 * Pins that every shared `DevicePollResult` variant maps to the right loop
 * action: pending keeps polling, slow-down widens the interval, network-error is
 * transient (keeps polling), the terminal 400 family ends the loop with its own
 * reason, and the device_code TTL elapsing turns a still-pending flow into
 * `expired`. The clock and inter-poll delay are injected so the loop runs
 * synchronously with no real timers.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runDeviceAuthorization } from "@traycer-clients/shared/auth/browser-device-auth-service";

const AUTHN_BASE_URL = "https://authn.example.test";

interface Spec {
  readonly status: number;
  readonly body: unknown;
  readonly headers?: Record<string, string>;
}

const AUTHORIZE_BODY = {
  device_code: "dev-code-1",
  user_code: "WXYZ-1234",
  verification_uri: "https://app.traycer.ai/device",
  verification_uri_complete: "https://app.traycer.ai/device?user_code=WXYZ-1234",
  expires_in: 600,
  interval: 5,
};

let originalFetch: typeof globalThis.fetch;
let urls: string[];

function installRouter(routes: Record<string, Spec[]>): void {
  const cursors: Record<string, number> = {};
  globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    urls.push(url);
    const key = Object.keys(routes).find((candidate) => url.includes(candidate));
    if (key === undefined) {
      throw new Error(`unexpected fetch to ${url}`);
    }
    const specs = routes[key];
    const index = cursors[key] ?? 0;
    const spec = specs[Math.min(index, specs.length - 1)];
    cursors[key] = index + 1;
    return new Response(JSON.stringify(spec.body), {
      status: spec.status,
      headers: { "content-type": "application/json", ...(spec.headers ?? {}) },
    });
  }) as typeof fetch;
}

interface Harness {
  readonly sleeps: number[];
  readonly progress: Array<{ userCode: string }>;
  run(): ReturnType<typeof runDeviceAuthorization>;
}

function makeHarness(): Harness {
  let clock = 0;
  const sleeps: number[] = [];
  const progress: Array<{ userCode: string }> = [];
  return {
    sleeps,
    progress,
    run: () =>
      runDeviceAuthorization({
        authnBaseUrl: AUTHN_BASE_URL,
        clientId: "mobile",
        hostLabel: "test",
        now: () => clock,
        sleep: async (ms) => {
          sleeps.push(ms);
          clock += ms;
        },
        signal: undefined,
        onProgress: (p) => {
          progress.push({ userCode: p.userCode });
        },
      }),
  };
}

beforeEach(() => {
  originalFetch = globalThis.fetch;
  urls = [];
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("runDeviceAuthorization", () => {
  it("projects progress and returns the minted pair after pending polls", async () => {
    installRouter({
      "device/authorize": [{ status: 200, body: AUTHORIZE_BODY }],
      "device/token": [
        { status: 428, body: {} },
        { status: 428, body: {} },
        { status: 200, body: { token: "acc", refreshToken: "ref" } },
      ],
    });
    const harness = makeHarness();

    const outcome = await harness.run();

    expect(outcome).toEqual({ kind: "authorized", token: "acc", refreshToken: "ref" });
    expect(harness.progress).toEqual([{ userCode: "WXYZ-1234" }]);
    // Three polls after the authorize call.
    expect(urls.filter((u) => u.includes("device/token"))).toHaveLength(3);
  });

  it("widens the interval on slow-down and keeps polling", async () => {
    installRouter({
      "device/authorize": [{ status: 200, body: AUTHORIZE_BODY }],
      "device/token": [
        { status: 429, body: { error: "slow_down" }, headers: { "Retry-After": "20" } },
        { status: 200, body: { token: "acc", refreshToken: "ref" } },
      ],
    });
    const harness = makeHarness();

    const outcome = await harness.run();

    expect(outcome.kind).toBe("authorized");
    // First sleep at the 5s base interval; after the 429 (Retry-After: 20) the
    // schedule widens to at least 20s.
    expect(harness.sleeps[0]).toBe(5_000);
    expect(harness.sleeps[1]).toBeGreaterThanOrEqual(20_000);
  });

  it("treats a network-error poll as transient and keeps polling", async () => {
    installRouter({
      "device/authorize": [{ status: 200, body: AUTHORIZE_BODY }],
      "device/token": [
        { status: 500, body: {} },
        { status: 200, body: { token: "acc", refreshToken: "ref" } },
      ],
    });

    const outcome = await makeHarness().run();

    expect(outcome).toEqual({ kind: "authorized", token: "acc", refreshToken: "ref" });
  });

  it.each([
    ["access_denied", "denied"],
    ["expired", "expired"],
    ["invalid_grant", "invalid"],
  ])("maps the terminal 400 %s to %s", async (error, expected) => {
    installRouter({
      "device/authorize": [{ status: 200, body: AUTHORIZE_BODY }],
      "device/token": [{ status: 400, body: { error } }],
    });

    const outcome = await makeHarness().run();

    expect(outcome.kind).toBe(expected);
  });

  it("ends as expired once the device_code TTL elapses while still pending", async () => {
    installRouter({
      // Short TTL: 10s with a 5s interval → the second expiry check trips.
      "device/authorize": [
        { status: 200, body: { ...AUTHORIZE_BODY, expires_in: 10, interval: 5 } },
      ],
      "device/token": [{ status: 428, body: {} }],
    });

    const outcome = await makeHarness().run();

    expect(outcome.kind).toBe("expired");
  });

  it("returns launch-failed when /device/authorize does not return a code", async () => {
    installRouter({
      "device/authorize": [{ status: 503, body: {} }],
    });

    const outcome = await makeHarness().run();

    expect(outcome).toEqual({ kind: "launch-failed" });
    expect(urls.some((u) => u.includes("device/token"))).toBe(false);
  });

  it("returns cancelled when the caller aborts before the first poll", async () => {
    installRouter({
      "device/authorize": [{ status: 200, body: AUTHORIZE_BODY }],
      "device/token": [{ status: 428, body: {} }],
    });
    const controller = new AbortController();

    const outcome = await runDeviceAuthorization({
      authnBaseUrl: AUTHN_BASE_URL,
      clientId: "mobile",
      hostLabel: "test",
      now: () => 0,
      sleep: async () => {
        controller.abort();
      },
      signal: controller.signal,
      onProgress: () => {},
    });

    expect(outcome).toEqual({ kind: "cancelled" });
  });
});
