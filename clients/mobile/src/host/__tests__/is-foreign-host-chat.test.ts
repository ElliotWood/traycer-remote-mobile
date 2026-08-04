/**
 * HA-1 mutation-bar guard for `isForeignHostChat` (`connection.ts:45-48`).
 *
 * Before this test existed, `hostId !== (CONFIGURED_HOST_ID ?? MOBILE_HOST_ID)`
 * had NO test anywhere in this package — `chat-view.tsx` calls it, but nothing
 * in `chat-view.test.tsx` exercises the foreign/local distinction itself.
 * Collapsing the expression to just the `MOBILE_HOST_ID` fallback would have
 * shipped silently. This is HA-1's stated acceptance bar: "collapse
 * `CONFIGURED_HOST_ID ?? MOBILE_HOST_ID` to just the fallback → the suite must
 * go red." The first test below is the discriminating one — it is the only
 * case where the real expression and the mutated one disagree.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Deliberately NOT `"mobile-host"` (hostile fixture, verification-practices
 * #1): a fixture equal to its own fallback can't tell "works" from "broken."
 */
const CONFIGURED_HOST_ID = "85a4a272-315f-4953-a282-9a33fe24c815";

/** A second real id, distinct from both the configured one and the fallback. */
const OTHER_REAL_HOST_ID = "9c9ddaf0-99ce-412a-b4b8-49e0b1d8a4ef";

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

// Imported after the mock is registered so `connection.ts`'s read of
// `CONFIGURED_HOST_ID` (a live getter, not a snapshot) picks up each test's
// `configMock.hostId`.
const { isForeignHostChat, MOBILE_HOST_ID } = await import("../connection");

describe("isForeignHostChat — HA-1 mutation guard", () => {
  it("reads a chat bound to the CONFIGURED host id as local — the discriminating case", () => {
    // Under the real expression: CONFIGURED_HOST_ID !== CONFIGURED_HOST_ID → false.
    // Under the mutation (collapsed to the fallback): CONFIGURED_HOST_ID !== "mobile-host" → true.
    // Only this case tells the two apart.
    expect(isForeignHostChat(CONFIGURED_HOST_ID)).toBe(false);
  });

  it("reads a chat bound to a different real host id as foreign", () => {
    expect(isForeignHostChat(OTHER_REAL_HOST_ID)).toBe(true);
  });

  it("reads a null hostId (not yet replicated) as local — assume-local, not foreign", () => {
    expect(isForeignHostChat(null)).toBe(false);
  });

  it("on an unconfigured build, still reads a legacy MOBILE_HOST_ID-stamped chat as local", () => {
    // Exercises the fallback operand itself, not just the configured one —
    // verification-practices #2 (mutate per field): a test suite that only
    // ever supplies CONFIGURED_HOST_ID would never notice the `?? MOBILE_HOST_ID`
    // arm being deleted outright.
    configMock.hostId = null;
    expect(isForeignHostChat(MOBILE_HOST_ID)).toBe(false);
  });

  it("on an unconfigured build, reads any other host id as foreign", () => {
    configMock.hostId = null;
    expect(isForeignHostChat(OTHER_REAL_HOST_ID)).toBe(true);
  });
});
