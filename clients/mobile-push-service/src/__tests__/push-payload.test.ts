import { describe, expect, it } from "vitest";
import { formatHostNotificationPresentation } from "@traycer/protocol/host/notifications/presentation";
import type { HostNotificationEntry } from "@traycer/protocol/host/notifications/host-notifications";
import { buildPushPayload } from "../push-payload";
import type { PushPayload } from "../push-sender";
import {
  ALL_ACTIONABLE_ENTRIES,
  APPROVAL_ENTRY,
  INTERVIEW_ENTRY,
  STALLED_ENTRY,
  STOPPED_ENTRY,
  WORKSPACE_FAILED_ENTRY,
} from "./fixtures";

/**
 * The golden wire fixture. `with { type: "json" }` rather than a `readFile`:
 * the import is resolved and parsed at module load, so a malformed fixture is
 * a load error rather than a test that quietly asserts against `undefined`.
 */
import WIRE from "./__fixtures__/push-activation-envelopes.json" with { type: "json" };

const HOST_ID = "host-abc";

function build(
  entries: ReadonlyArray<(typeof ALL_ACTIONABLE_ENTRIES)[number]>,
  originHostId: string | null,
): PushPayload {
  return buildPushPayload(
    entries.map((entry) => ({ id: entry.id, entry })),
    originHostId,
  );
}

/** `build` with this package's usual origin host, for the cases not about origin. */
function buildHere(
  entries: ReadonlyArray<(typeof ALL_ACTIONABLE_ENTRIES)[number]>,
): PushPayload {
  return build(entries, HOST_ID);
}

/**
 * What the CLIENT actually receives. `push-sender.ts` sends
 * `JSON.stringify(payload)` and `sw.ts` reads it back with `data.json()`, so
 * anything that does not survive that round trip is not part of the contract
 * however good it looks in memory. `undefined`-valued fields are dropped by
 * `JSON.stringify` — that is fine and intended (gui-app's parsers read a
 * missing field and an `undefined` field identically), but it must be ASSERTED
 * rather than assumed, because it is the difference between the object this
 * process holds and the object the phone parses.
 */
function overTheWire(payload: PushPayload): unknown {
  return JSON.parse(JSON.stringify(payload));
}

describe("buildPushPayload — copy comes from the shared formatter", () => {
  it.each(ALL_ACTIONABLE_ENTRIES)(
    "matches formatHostNotificationPresentation byte-for-byte for kind=$kind",
    (entry) => {
      const expected = formatHostNotificationPresentation(entry);
      const payload = buildHere([entry]);
      expect(payload.title).toBe(expected.title);
      expect(payload.body).toBe(expected.body);
    },
  );
});

describe("buildPushPayload — the activation envelope", () => {
  /**
   * Whole-object, not field-by-field. A field sweep only covers the fields
   * somebody thought of, and the defect this replaces was precisely an extra
   * field (`data`) that no assertion was looking at.
   */
  it("wraps an approval row in a V1 envelope carrying the approval route", () => {
    expect(overTheWire(buildHere([APPROVAL_ENTRY]))).toEqual({
      title: formatHostNotificationPresentation(APPROVAL_ENTRY).title,
      body: formatHostNotificationPresentation(APPROVAL_ENTRY).body,
      payload: {
        kind: "notificationActivation",
        version: 1,
        route: {
          kind: "approval",
          epicId: "epic-1",
          chatId: "chat-1",
          approvalId: "appr-1",
          // `sessionId` and `artifactId` are deliberately absent: they are
          // `undefined` at the source and JSON drops them, which gui-app's
          // `readString` reads back as `undefined`. Asserting the whole object
          // is what pins that down.
        },
        feed: { source: "host", id: APPROVAL_ENTRY.id },
        originHostId: HOST_ID,
      },
      replaceKey: "host:chat:chat-1",
    });
  });

  it("routes an interview row to its interview destination", () => {
    expect(overTheWire(buildHere([INTERVIEW_ENTRY]))).toMatchObject({
      payload: {
        kind: "notificationActivation",
        version: 1,
        route: {
          kind: "interview",
          epicId: "epic-1",
          chatId: "chat-2",
          interviewBlockId: "iv-1",
        },
        feed: { source: "host", id: INTERVIEW_ENTRY.id },
        originHostId: HOST_ID,
      },
      replaceKey: "host:chat:chat-2",
    });
  });

  it.each([
    [STALLED_ENTRY, "chat-3"],
    [STOPPED_ENTRY, "chat-4"],
    [WORKSPACE_FAILED_ENTRY, "chat-5"],
  ])("routes $kind to its chat", (entry, chatId) => {
    expect(overTheWire(buildHere([entry]))).toMatchObject({
      payload: {
        route: { kind: "chat", epicId: "epic-1", chatId },
      },
      replaceKey: `host:chat:${chatId}`,
    });
  });

  it("stamps the origin host so a click cannot land on a replica elsewhere", () => {
    const payload = build([APPROVAL_ENTRY], "host-other");
    expect(payload.payload?.originHostId).toBe("host-other");
  });

  it("records a null origin as null rather than omitting it", () => {
    // gui-app treats `null` as the legacy host-agnostic route, which is a
    // defined fallback. An ABSENT field is not: `parseEnvelopeV1` rejects the
    // envelope outright when `originHostId` is neither `null` nor a string,
    // and `undefined` is neither — so a dropped field would silently demote
    // every push to an unroutable click.
    const wire = overTheWire(build([APPROVAL_ENTRY, INTERVIEW_ENTRY], null));
    const single = overTheWire(build([APPROVAL_ENTRY], null)) as {
      payload: Record<string, unknown>;
    };
    expect(Object.keys(single.payload)).toContain("originHostId");
    expect(single.payload.originHostId).toBeNull();
    expect(wire).toBeDefined();
  });
});

describe("buildPushPayload — a row this build cannot parse gets no route", () => {
  /**
   * The designed degradation, reproduced from gui-app rather than improved on.
   * The row still carries `epicId`/`chatId` COLUMNS that would make a deep
   * link constructible; declining to use them is what keeps a push click and
   * an in-app click on the same destination.
   */
  it("emits a routeless push when the payload contradicts its row kind", () => {
    // Written as a whole literal rather than a spread of `APPROVAL_ENTRY`:
    // `HostNotificationEntry` is a union discriminated on `kind`, and
    // spreading a value of the union type widens `kind` back to the union, so
    // the result has to satisfy EVERY arm at once and no valid entry can be
    // expressed that way. The columns are kept populated on purpose — this row
    // COULD be deep-linked from them, and the assertion is that it is not.
    const fromNewerHost: HostNotificationEntry = {
      id: APPROVAL_ENTRY.id,
      updatedAt: 1_000,
      readAt: null,
      sourceRef: "appr-1",
      severity: "needs_action",
      epicId: "epic-1",
      chatId: "chat-1",
      kind: "approval.requested",
      outcome: null,
      resolvedAt: null,
      payload: { kind: "some_future_thing", epicId: "epic-1" },
    };
    const payload = buildHere([fromNewerHost]);
    expect(payload.payload).toBeNull();
    expect(payload.title.length).toBeGreaterThan(0);
    expect(payload.replaceKey).toBe(`host:id:${APPROVAL_ENTRY.id}`);
  });

  it("still deep-links the entries around it, in a later batch", () => {
    expect(buildHere([APPROVAL_ENTRY]).payload).not.toBeNull();
  });
});

describe("buildPushPayload — coalesced summary", () => {
  it("summarizes multiple transitions with no route", () => {
    const payload = buildHere([APPROVAL_ENTRY, INTERVIEW_ENTRY, STALLED_ENTRY]);
    expect(payload.title).toBe("3 chats need your attention");
    expect(payload.payload).toBeNull();
    expect(payload.replaceKey).toBe("notification-batch");
    expect(payload.body.length).toBeGreaterThan(0);
  });
});

describe("buildPushPayload — the checked-in wire contract", () => {
  /**
   * The PRODUCER half of a two-sided contract. The same file is parsed by
   * gui-app's real `parseNotificationActivationPayload` in
   * `clients/gui-app/src/lib/notifications/__tests__/push-service-envelope-contract.test.ts`.
   *
   * Why a golden file rather than importing the consumer's parser directly:
   * gui-app's `payload.ts` value-imports React Router, the canvas store and
   * the command palette, so the ~170 lines of pure parsing cannot be reached
   * from a Node service without dragging the renderer in. Splitting the
   * assertion across the two packages costs one checked-in file and buys a
   * check neither side can pass alone — a producer change reddens here, a
   * parser change reddens there.
   */
  it("still emits the exact bytes the consumer's test parses", () => {
    expect(overTheWire(build([APPROVAL_ENTRY], WIRE.hostId))).toEqual(
      WIRE.approval,
    );
    expect(overTheWire(build([INTERVIEW_ENTRY], WIRE.hostId))).toEqual(
      WIRE.interview,
    );
    expect(overTheWire(build([STALLED_ENTRY], WIRE.hostId))).toEqual(
      WIRE.stalled,
    );
    expect(overTheWire(build([STOPPED_ENTRY], WIRE.hostId))).toEqual(
      WIRE.stopped,
    );
    expect(overTheWire(build([WORKSPACE_FAILED_ENTRY], WIRE.hostId))).toEqual(
      WIRE.workspaceFailed,
    );
    expect(
      overTheWire(build([APPROVAL_ENTRY, INTERVIEW_ENTRY], WIRE.hostId)),
    ).toEqual(WIRE.summary);
  });
});

describe("buildPushPayload — the shape the worker reads", () => {
  /**
   * `sw.ts`'s `parsePush` reads `record.payload`; the shape this replaced put
   * the target under `record.data`. This asserts the NEGATIVE as well, because
   * the failure it guards against was a payload that looked complete and was
   * being read from a key nobody sent.
   */
  it.each(ALL_ACTIONABLE_ENTRIES)(
    "carries title/body/payload/replaceKey and no `data` for kind=$kind",
    (entry) => {
      const wire = overTheWire(buildHere([entry])) as Record<string, unknown>;
      expect(Object.keys(wire).sort()).toEqual([
        "body",
        "payload",
        "replaceKey",
        "title",
      ]);
      expect(wire).not.toHaveProperty("data");
    },
  );
});
