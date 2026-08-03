/**
 * Fixtures are BUILT FROM THE REAL UNION, and both blocking kinds appear.
 *
 * Two prior versions of this file failed for reasons worth keeping:
 *
 *   the first cast its fixture `as unknown as HostNotificationEntry` — the
 *   chained-assertion trap, caught by lint, and it would have compiled
 *   against any shape;
 *
 *   the second's composition fixture carried only `approval.requested`, so a
 *   mutation adding `kind !== "interview.requested"` was caught by a
 *   DIFFERENT test and not by the one written to catch it. **A fixture that
 *   exercises half a set cannot distinguish "filters correctly" from "returns
 *   everything".**
 *
 * `WatchEvent` is a plain discriminated union with no schema to parse
 * through, so the protection here is that the builders are typed as it — a
 * field added to the union breaks these at compile time rather than leaving
 * them quietly incomplete.
 */
import { describe, expect, it } from "vitest";
import { selectPushable } from "../select-pushable";
import {
  approvalEventId,
  interviewEventId,
  type WatchEvent,
} from "../../adapters/watch-events";

function approval(chatId: string, approvalId: string): WatchEvent {
  return {
    type: "appeared",
    kind: "approval.requested",
    eventId: approvalEventId(chatId, approvalId),
    epicId: "e1",
    chatId,
    chatTitle: null,
    approvalId,
    toolName: "Bash",
    description: "rm -rf",
    requestedAt: 1,
  };
}

function interview(chatId: string, blockId: string): WatchEvent {
  return {
    type: "appeared",
    kind: "interview.requested",
    eventId: interviewEventId(chatId, blockId),
    epicId: "e1",
    chatId,
    chatTitle: null,
    blockId,
    title: null,
    description: null,
    requestedAt: 1,
  };
}

function resolved(eventId: string): WatchEvent {
  return {
    type: "resolved",
    kind: "approval.requested",
    eventId,
    epicId: "e1",
    chatId: "c1",
  };
}

const EMPTY: ReadonlySet<string> = new Set();

describe("both blocking kinds push", () => {
  it("pushes an approval AND an interview, not just the first kind", () => {
    /*
     * BOTH KINDS, deliberately. The producer's union cannot express a
     * non-blocking kind, so there is nothing to filter — and a fixture with
     * one kind could not tell "pushes everything" from "pushes only
     * approvals", which is the mistake the previous version made.
     *
     * Mutation: `push` only when `kind === "approval.requested"`. The
     * interview id disappears and this fails.
     */
    const plan = selectPushable({
      events: [approval("c1", "a1"), interview("c2", "b1")],
      alreadySent: EMPTY,
    });
    expect(plan.push.map((e) => e.kind)).toEqual([
      "approval.requested",
      "interview.requested",
    ]);
  });

  it("preserves emission order", () => {
    // A screen can be scanned; a sequence of notifications arrives in the
    // order it is sent, and `bridge watch` already emits oldest-first.
    const plan = selectPushable({
      events: [approval("c1", "a1"), approval("c1", "a2")],
      alreadySent: EMPTY,
    });
    expect(plan.push.map((e) => e.eventId)).toEqual([
      approvalEventId("c1", "a1"),
      approvalEventId("c1", "a2"),
    ]);
  });
});

describe("idempotency across a restart", () => {
  it("suppresses an event already sent", () => {
    /*
     * Mutation: ignore `alreadySent`. Length goes 0 → 1.
     *
     * The failure mode is not a duplicate card — it is a user who turns the
     * bot off, after which every later notification is lost too and nothing
     * reports that they were.
     */
    const id = approvalEventId("c1", "a1");
    const plan = selectPushable({
      events: [approval("c1", "a1")],
      alreadySent: new Set([id]),
    });
    expect(plan.push).toHaveLength(0);
    // Still remembered — suppression must not also forget.
    expect(plan.nextSent.has(id)).toBe(true);
  });

  it("is stable when the same tick repeats", () => {
    const events = [approval("c1", "a1")];
    const first = selectPushable({ events, alreadySent: EMPTY });
    const second = selectPushable({ events, alreadySent: first.nextSent });
    expect(second.push).toHaveLength(0);
    expect(second.nextSent).toEqual(first.nextSent);
  });
});

describe("resolved FORGETS rather than being ignored", () => {
  it("drops the id so a re-raise can notify again", () => {
    /*
     * Mutation: `continue` on `resolved` without deleting. The re-raise below
     * is silently swallowed — and a notification not sent because of a stale
     * bookkeeping entry is indistinguishable, to the user, from an agent that
     * never asked.
     */
    const id = approvalEventId("c1", "a1");
    const afterResolve = selectPushable({
      events: [resolved(id)],
      alreadySent: new Set([id]),
    });
    expect(afterResolve.nextSent.has(id)).toBe(false);

    const reRaised = selectPushable({
      events: [approval("c1", "a1")],
      alreadySent: afterResolve.nextSent,
    });
    expect(reRaised.push).toHaveLength(1);
  });

  it("never pushes a resolved event itself", () => {
    // `resolved` is bookkeeping, not news. Pushing it would send a card about
    // a decision that no longer needs one.
    const plan = selectPushable({
      events: [resolved(approvalEventId("c1", "a1"))],
      alreadySent: EMPTY,
    });
    expect(plan.push).toHaveLength(0);
  });

  it("handles resolve-then-reappear WITHIN one tick", () => {
    /*
     * Emission order is processed as given rather than partitioned by type.
     * Partitioning — all resolves, then all appeareds, or the reverse — gets
     * this wrong in one direction or the other, and it is the case a naive
     * implementation is most likely to reach for.
     *
     * Mutation: process all `resolved` first. The re-raise is then suppressed
     * or double-counted depending on order, and this fails.
     */
    const id = approvalEventId("c1", "a1");
    const plan = selectPushable({
      events: [resolved(id), approval("c1", "a1")],
      alreadySent: new Set([id]),
    });
    expect(plan.push).toHaveLength(1);
    expect(plan.nextSent.has(id)).toBe(true);
  });

  it("does NOT re-push when the appear comes BEFORE the resolve in a tick", () => {
    /*
     * THE ORDER THAT DISCRIMINATES, and the case above does not.
     *
     * Measured: a mutation sorting `resolved` events to the front left the
     * case above GREEN, because its fixture is already resolve-first — the
     * sort was a no-op for that input. **A fixture already in the order under
     * test cannot detect a reordering.** Same shape as the arrow-clamp test
     * and the half-a-set fixture: an assertion that reads as strict over an
     * input that cannot distinguish the branches.
     *
     * Here the event appeared and was then answered within one tick. Correct
     * behaviour pushes it once (it was news when it appeared) and forgets it
     * (it is answered now). Processing resolves first would suppress the push
     * entirely — a notification silently dropped for a decision the user was
     * never told about.
     */
    const id = approvalEventId("c1", "a1");
    const plan = selectPushable({
      events: [approval("c1", "a1"), resolved(id)],
      alreadySent: new Set(),
    });
    expect(plan.push).toHaveLength(1);
    expect(plan.nextSent.has(id)).toBe(false);
  });
});
