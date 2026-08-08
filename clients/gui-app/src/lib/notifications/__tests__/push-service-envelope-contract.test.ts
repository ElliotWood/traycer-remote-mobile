/**
 * The CONSUMER half of the push-service wire contract.
 *
 * `clients/mobile-push-service` sends a background Web Push; the service
 * worker hands `notification.data` straight to this app's click routing
 * without parsing it. So the only thing standing between a real push and a
 * tap that goes nowhere is whether THESE parsers accept THOSE bytes — and
 * until this file existed, nothing checked that. The service had in fact been
 * emitting `{title, body, data:{epicId, chatId}}`, which this parser rejects
 * outright: wrong key for the worker, and no `kind` discriminator for
 * `parseNotificationPayload`. Title and body were correct, so the failure
 * would only ever have shown up as a tap that opened the wrong thing.
 *
 * The fixture is the producer's checked-in golden output, asserted from its
 * own side too (`push-payload.test.ts` → "still emits the exact bytes the
 * consumer's test parses"). Neither package can drift alone.
 *
 * This is a JSON file rather than a cross-package import on purpose: the
 * service is a Node process that cannot import this module (it value-imports
 * the router, the canvas store and the command palette), and this app has no
 * business depending on the service. A file both can read is the only seam
 * that does not create a dependency in a direction neither wants.
 */
import { describe, expect, it } from "vitest";
import {
  isNotificationPayloadRoutable,
  type NotificationPayload,
} from "@/lib/notifications/payload";
import { parseNotificationActivationPayload } from "@/lib/notifications/notification-activation-envelope";
import WIRE from "../../../../../mobile-push-service/src/__tests__/__fixtures__/push-activation-envelopes.json" with { type: "json" };

interface WirePush {
  readonly title: string;
  readonly body: string;
  readonly payload: unknown;
  readonly replaceKey: string;
}

const ROUTED: ReadonlyArray<readonly [string, WirePush, NotificationPayload]> = [
  [
    "approval",
    WIRE.approval,
    {
      kind: "approval",
      epicId: "epic-1",
      chatId: "chat-1",
      approvalId: "appr-1",
      sessionId: undefined,
      artifactId: undefined,
    },
  ],
  [
    "interview",
    WIRE.interview,
    {
      kind: "interview",
      epicId: "epic-1",
      chatId: "chat-2",
      interviewBlockId: "iv-1",
    },
  ],
  [
    "agent stalled",
    WIRE.stalled,
    { kind: "chat", epicId: "epic-1", chatId: "chat-3" },
  ],
  [
    "agent stopped",
    WIRE.stopped,
    { kind: "chat", epicId: "epic-1", chatId: "chat-4" },
  ],
  [
    "workspace operation failed",
    WIRE.workspaceFailed,
    { kind: "chat", epicId: "epic-1", chatId: "chat-5" },
  ],
];

describe("push-service activation envelopes", () => {
  it.each(ROUTED)("parses the %s push as a V1 envelope", (_label, push) => {
    const parsed = parseNotificationActivationPayload(push.payload);
    expect(parsed.kind).toBe("v1");
  });

  /**
   * Whole-object on `route`, not a `kind` check. `parseNotificationPayload`
   * drops any field it does not recognise, so a route that lost `approvalId`
   * on the wire would still parse as an approval and still report `v1` — the
   * assertion has to be the projection, not its tag.
   */
  it.each(ROUTED)(
    "resolves the %s push to its exact route",
    (_label, push, expected) => {
      const parsed = parseNotificationActivationPayload(push.payload);
      if (parsed.kind !== "v1") throw new Error(`not v1: ${parsed.kind}`);
      expect(parsed.envelope.route).toEqual(expected);
    },
  );

  it.each(ROUTED)("routes the %s push somewhere", (_label, push) => {
    const parsed = parseNotificationActivationPayload(push.payload);
    if (parsed.kind !== "v1") throw new Error(`not v1: ${parsed.kind}`);
    // A payload can parse and still be a dead end - `session` rows do exactly
    // that. This is the difference between "understood" and "actionable".
    expect(isNotificationPayloadRoutable(parsed.envelope.route)).toBe(true);
  });

  it.each(ROUTED)(
    "carries the origin host on the %s push, so a replica elsewhere is not reused",
    (_label, push) => {
      const parsed = parseNotificationActivationPayload(push.payload);
      if (parsed.kind !== "v1") throw new Error(`not v1: ${parsed.kind}`);
      expect(parsed.envelope.originHostId).toBe(WIRE.hostId);
      expect(parsed.envelope.feed.source).toBe("host");
      expect(parsed.envelope.feed.id.length).toBeGreaterThan(0);
    },
  );

  it("reports the coalesced summary as unknown, which opens the centre", () => {
    // `null` is what the service sends when a batch has no single destination.
    // `unknown` is the correct reading and is NOT a failure: the focus bridge
    // answers it by opening the notification centre, which shows every row in
    // the batch - a better destination than an arbitrary one of them.
    expect(WIRE.summary.payload).toBeNull();
    expect(parseNotificationActivationPayload(WIRE.summary.payload).kind).toBe(
      "unknown",
    );
  });

  /**
   * The control. Without it, every assertion above could be passing because
   * the parser is permissive rather than because the producer is correct.
   * This is the shape the service actually sent before this contract existed.
   */
  it("REJECTS the shape the service used to send", () => {
    const legacy = { epicId: "epic-1", chatId: "chat-1" };
    expect(parseNotificationActivationPayload(legacy).kind).toBe("unknown");
  });
});
