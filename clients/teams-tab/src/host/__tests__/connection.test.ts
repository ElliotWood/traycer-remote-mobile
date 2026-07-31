import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `@/config` reads build-time Vite env at module load, so it is mocked with a
 * mutable object rather than restubbed per test — `isForeignHost` reads the
 * binding at call time, which is what makes a single mock cover every case.
 */
const config = vi.hoisted(() => ({
  CONFIGURED_HOST_ID: "",
  HOST_WS_URL: "",
}));
vi.mock("@/config", () => config);

const { TAB_HOST_LABEL, createTabHostConnection, isForeignHost } = await import(
  "../connection"
);

const HOST = "a1000000-0000-4000-8000-000000000e91";

beforeEach(() => {
  config.CONFIGURED_HOST_ID = HOST;
  config.HOST_WS_URL = "wss://example.invalid/rpc";
});

describe("isForeignHost", () => {
  it("a row on the configured host is not foreign", () => {
    expect(isForeignHost(HOST)).toBe(false);
  });

  it("a row on another host is foreign", () => {
    expect(isForeignHost("some-other-host")).toBe(true);
  });

  it("CONTRACT: a null hostId is NOT foreign", () => {
    // "Not replicated yet" is unknown, not elsewhere. Rendering unknown as
    // foreign is the same category error as rendering unobservable as idle.
    expect(isForeignHost(null)).toBe(false);
  });

  it("CONTRACT: an unconfigured build calls nothing foreign", () => {
    // With no configured id there is no basis for the comparison, so every
    // row would otherwise be declared foreign and the whole fleet would
    // render as unreachable.
    config.CONFIGURED_HOST_ID = "";
    expect(isForeignHost(HOST)).toBe(false);
    expect(isForeignHost("anything")).toBe(false);
    expect(isForeignHost(null)).toBe(false);
  });
});

describe("the local label is not the durable host id", () => {
  it("CONTRACT: comparison is against the configured id, never the local label", () => {
    // `TAB_HOST_LABEL` is what `HostClient` keys on locally; the durable id
    // is what rows carry in `hostId`. Comparing against the label would make
    // every agent look local — a failure this surface has already shipped
    // once by another route.
    expect(TAB_HOST_LABEL).not.toBe(config.CONFIGURED_HOST_ID);
    expect(isForeignHost(TAB_HOST_LABEL)).toBe(true);
  });

  it("the label is a stable non-empty string", () => {
    expect(TAB_HOST_LABEL.trim().length).toBeGreaterThan(0);
  });
});

describe("createTabHostConnection", () => {
  const auth = {
    current: () => null,
    onChange: () => () => undefined,
    revalidate: async () => null,
    authority: "https://example.invalid",
  };

  it("CONTRACT: returns null when no host WS URL is configured", () => {
    // The caller renders a configuration prompt. Dialing an empty URL would
    // fail at first RPC instead, which from inside Teams looks like an
    // outage rather than a missing build variable.
    config.HOST_WS_URL = "";
    expect(
      createTabHostConnection(auth as never),
    ).toBeNull();
  });

  it("builds a connection when the URL is present, and disposes cleanly", () => {
    const conn = createTabHostConnection(auth as never);
    expect(conn).not.toBeNull();
    expect(conn?.hostClient).toBeDefined();
    expect(() => conn?.dispose()).not.toThrow();
  });
});
