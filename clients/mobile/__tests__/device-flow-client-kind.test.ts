import { afterEach, describe, expect, it, vi } from "vitest";
import { MobileRunnerHost } from "../src/mobile-runner-host";

// The web shell (`src/web/main.tsx`) signs in through this host, and the
// deployed authn accepts only two device client kinds. Measured 2026-08-30:
//
//   curl -X POST https://authn.traycer.ai/api/v3/auth/device/authorize \
//     -H 'Content-Type: application/json' \
//     -d '{"client_id":"mobile","host_label":"probe"}'
//   -> 400 {"error":"client_id must be 'cli' or 'desktop'"}
//
// authn.dev.traycer.ai answers 200 for the same body. Upstream flipped its
// native shell to "mobile" (#1525) and wrote down that production authn must
// accept it before an app carrying it ships. A merge that takes upstream's
// host wholesale would therefore ship a web shell whose Sign in fails at
// `/device/authorize` - and the flow reads any non-200 there as
// `network-error`, so nothing on screen would name the cause. This test is
// the gate: it goes red at merge time instead. Re-run the probe above before
// changing the expected kind.

vi.mock("@capacitor/browser", () => ({
  Browser: {
    open: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  },
}));

vi.mock("capacitor-secure-storage-plugin", () => ({
  SecureStoragePlugin: {
    keys: vi.fn(async () => ({ value: [] as string[] })),
    get: vi.fn(async () => ({ value: "" })),
    set: vi.fn(async () => ({ value: true })),
    remove: vi.fn(async () => ({ value: true })),
  },
}));

describe("web shell device flow", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts the device flow as a client kind the deployed authn accepts", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        device_code: "device-code",
        user_code: "ABCDE-FGHIJ",
        verification_uri: "https://app.traycer.test/device",
        verification_uri_complete:
          "https://app.traycer.test/device?user_code=ABCDE-FGHIJ",
        expires_in: 600,
        // Far enough away that the session never polls before `cancel()`.
        interval: 600,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const host = new MobileRunnerHost({
      signInUrl: "http://localhost:32352/sign-in",
      authnBaseUrl: "http://localhost:32350",
      hostLabel: "test-slot",
      relayBaseUrl: "ws://localhost:8787/attach",
    });
    const session = await host.deviceFlow.start();
    session?.cancel();

    expect(session).not.toBeNull();
    // The session polls `/device/token` once immediately, so there are two
    // calls by now; the first is the authorize request under test.
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      "http://localhost:32350/api/v3/auth/device/authorize",
    );
    // The whole body, so a renamed or dropped field fails here too.
    expect(JSON.parse(String(init?.body))).toEqual({
      client_id: "desktop",
      host_label: "test-slot",
    });
    // Every call in the flow carries the kind, not just the first.
    for (const [, callInit] of fetchMock.mock.calls) {
      expect(JSON.parse(String(callInit?.body))).toMatchObject({
        client_id: "desktop",
      });
    }
  });
});
