/**
 * HA-1 (critique finding 12 — the "third host id"): `stream-connection.ts`'s
 * `getHostId()` must reflect the real configured host id when one exists,
 * rather than staying a constant unrelated to `CONFIGURED_HOST_ID` — the same
 * shape `MOBILE_HOST_ID`-as-durable-id had before HA-1's earlier fix.
 * Grep-checked before this test was written: `ws-stream-client.ts` /
 * `ws-rpc-client.ts` don't key sessions on this value today, so nothing
 * downstream breaks either way — this test exists so a FUTURE per-machine
 * consumer (HA-4) inherits the real id rather than a silently-wrong
 * hardcoded one.
 *
 * `getHostId()` is a function, not a constant, precisely so importing this
 * module has no side effect on `@/config` at module-load time — see the
 * docblock on `getHostId` itself for the regression that shape caused.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const CONFIGURED_HOST_ID = "85a4a272-315f-4953-a282-9a33fe24c815";

const configMock = { hostId: CONFIGURED_HOST_ID as string | null };
vi.mock("@/config", () => ({
  get CONFIGURED_HOST_ID() {
    return configMock.hostId;
  },
  HOST_WS_URL: null,
}));

beforeEach(() => {
  configMock.hostId = CONFIGURED_HOST_ID;
});

describe("stream-connection getHostId — HA-1 third-id reconciliation", () => {
  it("derives from the real configured host id when one is set", async () => {
    const { getHostId } = await import("../stream-connection");
    expect(getHostId()).toBe(CONFIGURED_HOST_ID);
  });

  it("falls back to the existing local-only label on an unconfigured build", async () => {
    configMock.hostId = null;
    const { getHostId } = await import("../stream-connection");
    const { DEFAULT_STREAM_HOST_ID } = await import(
      "@traycer-clients/shared/host-transport/single-host-stream-connection"
    );
    expect(getHostId()).toBe(DEFAULT_STREAM_HOST_ID);
    expect(getHostId()).not.toBe(CONFIGURED_HOST_ID);
  });
});
