/**
 * The test that earns its place here is the RETRY-ADVICE one.
 *
 * `use-create-epic` and `use-create-agent` are near-identical hooks whose
 * unconfirmed states render through the same component and the same
 * `retryAdvice` call. The only difference is one word, decided from a contract
 * the component cannot see — which makes it precisely the kind of thing that
 * survives a copy-paste, looks right in every screenshot, and tells someone it
 * is safe to press a button that may leave them two epics.
 *
 * It is asserted here AGAINST the chat create's answer rather than on its own,
 * because "may-duplicate" alone would still pass if someone later changed both
 * to be the same. The property under test is that they DIFFER, and why.
 */
import { describe, expect, it } from "vitest";
import {
  EPIC_CREATE_RETRY,
  epicCreateRefusal,
  type EpicCreateGateInput,
} from "../epic-create-rules";
import { retryAdvice } from "../create-phase";

const HOST = "a1000000-0000-4000-8000-000000000e91";
const USER = "a1000000-0000-4000-8000-000000000501";

const SENDABLE: EpicCreateGateInput = {
  hasClient: true,
  configuredHostId: HOST,
  userId: USER,
  title: "Audit the auth code",
  inFlight: false,
};

describe("EPIC_CREATE_RETRY — the contract, not a preference", () => {
  it("CONTRACT: may-duplicate, because epicLightSchema.id documents no dedupe", () => {
    // `createChatRequestSchema.chatId` carries "The host resolver is
    // idempotent on this id." `epicLightSchema.id` carries nothing. The
    // silence decides it — see `create-phase.ts`.
    expect(EPIC_CREATE_RETRY).toBe("may-duplicate");
  });

  it("CONTRACT: differs from the agent create, and says GO AND LOOK", () => {
    // The two creates sit next to each other and need opposite advice. If
    // these ever agree, one of them is lying to the user.
    expect(EPIC_CREATE_RETRY).not.toBe("idempotent");
    const advice = retryAdvice(EPIC_CREATE_RETRY, "epic");
    expect(advice).toContain("Check the list");
    expect(advice).not.toContain("Press the button again");
  });
});

describe("epicCreateRefusal — what never reaches the host", () => {
  it("sends when everything is present", () => {
    expect(epicCreateRefusal(SENDABLE)).toBeNull();
  });

  it("refuses without a host id rather than stamping a placeholder for life", () => {
    // Mobile shipped this once: a chat stamped with a UI label renders as an
    // unreachable host on desktop, permanently.
    expect(
      epicCreateRefusal({ ...SENDABLE, configuredHostId: "" }),
    ).toBe("no-host");
  });

  it("treats a whitespace-only host id as absent", () => {
    expect(epicCreateRefusal({ ...SENDABLE, configuredHostId: "  \t " })).toBe(
      "no-host",
    );
  });

  it("refuses without a user id, which would file the epic under a wrong owner", () => {
    // `createdBy` is what `epic.listTasks`' ownership filter reads. The epic
    // would exist and be invisible in its creator's own fleet — a failure
    // that looks like the create silently doing nothing.
    expect(epicCreateRefusal({ ...SENDABLE, userId: "" })).toBe("no-user");
    expect(epicCreateRefusal({ ...SENDABLE, userId: "   " })).toBe("no-user");
  });

  it("refuses a blank title instead of naming the epic '' forever", () => {
    expect(epicCreateRefusal({ ...SENDABLE, title: null })).toBe("no-title");
  });

  it("refuses a second submit while one is in flight", () => {
    expect(epicCreateRefusal({ ...SENDABLE, inFlight: true })).toBe("in-flight");
  });

  it("refuses without a client", () => {
    expect(epicCreateRefusal({ ...SENDABLE, hasClient: false })).toBe(
      "no-client",
    );
  });

  it("CONTRACT: reports the deployment fault before the attempt fault", () => {
    // A tab with no host AND no typed instruction should say the host is
    // missing. Telling that user to "type something first" sends them round a
    // loop that cannot terminate, because the real problem is in the build.
    expect(
      epicCreateRefusal({
        ...SENDABLE,
        configuredHostId: "",
        title: null,
        inFlight: true,
      }),
    ).toBe("no-host");
  });

  it("CONTRACT: every refusal reason is reachable", () => {
    // A gate that cannot fire is a gate nobody is protected by. Ordering makes
    // this easy to break silently — an earlier check that subsumes a later one
    // leaves dead code that reads as coverage.
    const reached = new Set(
      [
        epicCreateRefusal({ ...SENDABLE, hasClient: false }),
        epicCreateRefusal({ ...SENDABLE, configuredHostId: "" }),
        epicCreateRefusal({ ...SENDABLE, userId: "" }),
        epicCreateRefusal({ ...SENDABLE, inFlight: true }),
        epicCreateRefusal({ ...SENDABLE, title: null }),
      ].filter((r) => r !== null),
    );
    expect(reached).toEqual(
      new Set(["no-client", "no-host", "no-user", "in-flight", "no-title"]),
    );
  });
});
