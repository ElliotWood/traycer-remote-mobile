/**
 * The send path's branches, each asserted on the DECISION it makes rather
 * than on "it didn't throw".
 *
 * The two that carry the correctness, and both are silent when wrong:
 *
 *   1. a failed send must NOT mark the event sent, or a credential blip
 *      swallows an approval permanently;
 *   2. only `gone` may discard the conversation reference.
 */
import { describe, expect, it } from "vitest";
import { pushWatchEvent, type PushDeps, type SendProactive } from "../push-notifications";
import type { ProactiveStore, ProactiveTarget } from "../proactive-store";
import type { StoredConversationReference } from "../../state/conversation-reference-store";
import {
  approvalAppearedSchema,
  resolvedSchema,
  type ApprovalAppeared,
  type WatchEvent,
} from "../watch-line";

const REFERENCE: StoredConversationReference = {
  channelId: "msteams",
  serviceUrl: "https://smba.example/au/",
  conversation: { id: "conv-1", conversationType: "personal" },
  bot: { id: "agent-1", name: "Traycer" },
  user: { id: "user-1" },
  tenantId: "tenant-1",
  capturedAt: 1,
};

/**
 * Built through the real schema rather than a cast: `.parse()` applies the
 * schema's own rules, so a fixture cannot drift into a shape the parser
 * would reject while the test keeps passing.
 */
function approval(eventId: string, epicId: string): ApprovalAppeared {
  return approvalAppearedSchema.parse({
    type: "appeared",
    kind: "approval.requested",
    eventId,
    epicId,
    chatId: "chat-1",
    chatTitle: "Build the thing",
    approvalId: "ap-1",
    toolName: "Bash",
    description: "rm -rf /tmp/scratch",
    requestedAt: 1000,
  });
}

function resolved(eventId: string, epicId: string): WatchEvent {
  return resolvedSchema.parse({
    type: "resolved",
    kind: "approval.requested",
    eventId,
    epicId,
    chatId: "chat-1",
  });
}

class FakeStore implements ProactiveStore {
  private readonly targets = new Map<string, ProactiveTarget>();
  private readonly sent = new Map<string, number>();

  constructor(boundEpicIds: readonly string[]) {
    for (const epicId of boundEpicIds) {
      this.targets.set(epicId, { reference: REFERENCE, boundAt: 1 });
    }
  }

  targetFor(epicId: string): ProactiveTarget | null {
    return this.targets.get(epicId) ?? null;
  }
  bindTarget(epicId: string, target: ProactiveTarget): void {
    this.targets.set(epicId, target);
  }
  discardTarget(epicId: string): void {
    this.targets.delete(epicId);
  }
  boundEpics(): readonly string[] {
    return [...this.targets.keys()];
  }
  hasSent(eventId: string): boolean {
    return this.sent.has(eventId);
  }
  recordSent(eventId: string, sentAt: number): void {
    this.sent.set(eventId, sentAt);
  }
  forgetSent(eventId: string): void {
    this.sent.delete(eventId);
  }
  sentEventIds(): readonly string[] {
    return [...this.sent.keys()];
  }
}

interface Harness {
  readonly deps: PushDeps;
  readonly store: FakeStore;
  readonly warnings: string[];
  readonly sends: readonly { readonly event: WatchEvent }[];
}

function harness(store: FakeStore, send: SendProactive): Harness {
  const warnings: string[] = [];
  /*
   * RECORDS THE EVENTS, not a count.
   *
   * This was `number[]` — one `1` pushed per call — which could answer "how
   * many sends" and nothing else. Once a `resolved` event can also produce a
   * send, a count cannot tell a correction from a second copy of the request,
   * and those are opposite outcomes: one fixes a stale card, the other is the
   * duplicate this file's whole ordering argument is about.
   */
  const sends: { readonly event: WatchEvent }[] = [];
  const counting: SendProactive = async (target, event) => {
    sends.push({ event });
    await send(target, event);
  };
  return {
    store,
    warnings,
    sends,
    deps: {
      store,
      send: counting,
      now: () => 12345,
      onWarn: (message, detail) => warnings.push(`${message}|${detail}`),
    },
  };
}

const succeeds: SendProactive = async () => {};

function failsWith(status: number): SendProactive {
  return async () => {
    // The SDK throws an `HttpError` carrying a numeric `status`. Reproduced
    // structurally, which is exactly how `outcomeOfSendError` reads it.
    const error: Error & { status?: number } = new Error(`HTTP ${String(status)}`);
    error.status = status;
    throw error;
  };
}

describe("a failed send must not be remembered as sent", () => {
  it("leaves the event unsent on 401, so the next tick retries it", async () => {
    /*
     * THE test this file exists for.
     *
     * Mutation: move `recordSent` to before the `await deps.send(...)` in
     * `pushWatchEvent`. This assertion fails — and note the result-kind
     * assertion above it would still pass, which is why the store is
     * inspected rather than the return value alone.
     *
     * The defect being guarded: an auth blip marks an approval notified
     * forever. The user is never told, and it is indistinguishable from an
     * agent that never asked.
     */
    const h = harness(new FakeStore(["epic-1"]), failsWith(401));
    const result = await pushWatchEvent(h.deps, approval("e1", "epic-1"));

    expect(result.kind).toBe("failed");
    expect(h.store.hasSent("e1")).toBe(false);
    // And the route survives, because 401 is our bug, not their uninstall.
    expect(h.store.targetFor("epic-1")).not.toBeNull();
  });

  it("records the send only when Bot Service accepted it", async () => {
    const h = harness(new FakeStore(["epic-1"]), succeeds);
    const result = await pushWatchEvent(h.deps, approval("e1", "epic-1"));

    expect(result).toEqual({ kind: "sent", eventId: "e1" });
    expect(h.store.hasSent("e1")).toBe(true);
  });
});

describe("only `gone` discards the conversation reference", () => {
  it("discards on 403 and KEEPS the route on 401, 429 and a network error", async () => {
    /*
     * Mutation: make `shouldDiscardReference` true for `auth` as well. The
     * second assertion fails. Asserting opposite booleans rather than two
     * flavours of truthy is what stops this passing with the branches
     * collapsed — the same shape as the classify test one file over.
     */
    const uninstalled = harness(new FakeStore(["epic-1"]), failsWith(403));
    await pushWatchEvent(uninstalled.deps, approval("e1", "epic-1"));
    expect(uninstalled.store.targetFor("epic-1")).toBeNull();

    for (const send of [failsWith(401), failsWith(429)]) {
      const kept = harness(new FakeStore(["epic-1"]), send);
      await pushWatchEvent(kept.deps, approval("e1", "epic-1"));
      expect(kept.store.targetFor("epic-1")).not.toBeNull();
    }

    // No status at all — DNS/TLS/timeout. Must not delete state either.
    const unreachable = harness(new FakeStore(["epic-1"]), async () => {
      throw new Error("getaddrinfo ENOTFOUND smba.example");
    });
    const result = await pushWatchEvent(unreachable.deps, approval("e1", "epic-1"));
    expect(unreachable.store.targetFor("epic-1")).not.toBeNull();
    expect(result).toMatchObject({ kind: "failed", referenceDiscarded: false });
  });
});

describe("idempotency across a bridge restart", () => {
  it("does not send the same event twice, and makes no call at all", async () => {
    /*
     * The bridge re-announces every open approval after ITS restart. The
     * `sends` counter matters as much as the result kind: a duplicate that
     * still called Bot Service would be rate-limit exposure even if nothing
     * reached the user.
     */
    const h = harness(new FakeStore(["epic-1"]), succeeds);
    await pushWatchEvent(h.deps, approval("e1", "epic-1"));
    const second = await pushWatchEvent(h.deps, approval("e1", "epic-1"));

    expect(second).toEqual({ kind: "duplicate", eventId: "e1" });
    expect(h.sends.length).toBe(1);
  });

  it("forgets a resolved event so a re-raise notifies again", async () => {
    /*
     * Mutation: make the `resolved` branch `return` without calling
     * `forgetSent`. The final assertion flips to "duplicate" — a re-raised
     * approval silently swallowed, which the user cannot tell from an agent
     * that never asked.
     *
     * UPDATED 2026-08-10: this asserted `kind: "forgotten"` and
     * `sends.length === 1` — i.e. that a resolution sends NOTHING. That
     * behaviour changed deliberately (see below), so the assertion changed
     * with it. The property this test actually exists to protect — that the
     * bookkeeping is cleared, so a re-raise notifies again — is unchanged and
     * still the last two lines.
     */
    const h = harness(new FakeStore(["epic-1"]), succeeds);
    await pushWatchEvent(h.deps, approval("e1", "epic-1"));

    const resolvedResult = await pushWatchEvent(h.deps, resolved("e1", "epic-1"));
    expect(resolvedResult).toEqual({ kind: "corrected", eventId: "e1" });

    const reRaised = await pushWatchEvent(h.deps, approval("e1", "epic-1"));
    expect(reRaised.kind).toBe("sent");
  });

  it("CONTRACT: a resolution CORRECTS a card we already sent", async () => {
    /*
     * Elliot rejected an approval from the CLI and Teams went on showing a
     * card that said it needed him. The card cannot refresh itself — every
     * action this bot emits is `Action.Submit`, which has no in-place update —
     * so the last thing on screen was a live-looking request for a decision
     * already made elsewhere.
     *
     * A notification that becomes false and stays on screen is worse than no
     * notification: the interface is asserting something untrue and the user
     * cannot tell it from a real one.
     */
    const h = harness(new FakeStore(["epic-1"]), succeeds);
    await pushWatchEvent(h.deps, approval("e1", "epic-1"));
    expect(h.sends.length).toBe(1);

    await pushWatchEvent(h.deps, resolved("e1", "epic-1"));
    expect(h.sends.length).toBe(2);
    // The second send is the RESOLUTION, not a repeat of the request.
    expect(h.sends[1].event.type).toBe("resolved");
  });

  it("CONTRACT: a resolution for something we never announced stays silent", async () => {
    /*
     * The gate is `hasSent`, and it is the whole difference between
     * correcting a claim and inventing one. Without it, every approval
     * resolved on the desktop — the overwhelming majority, since the desktop
     * is where people work — would produce a Teams message about a request
     * the user never saw. That is noise, and noise is what trains someone to
     * ignore the channel that also carries the real ones.
     */
    const h = harness(new FakeStore(["epic-1"]), succeeds);
    const result = await pushWatchEvent(h.deps, resolved("never-sent", "epic-1"));
    expect(result).toEqual({ kind: "forgotten", eventId: "never-sent" });
    expect(h.sends.length).toBe(0);
  });

  it("clears the bookkeeping even when the correction cannot be sent", async () => {
    /*
     * Keeping the entry on a failed correction would mean a re-raise of the
     * same id never notifies — trading a missed courtesy message for a missed
     * APPROVAL, which is the wrong way round. The failure is a journal line,
     * not a retry.
     */
    // Fails ONLY the correction, so the re-raise on the last line is a real
    // measurement of the bookkeeping rather than of a still-broken sender.
    const h = harness(new FakeStore(["epic-1"]), async (_target, event) => {
      if (event.type === "resolved") throw new Error("boom");
    });
    await pushWatchEvent(h.deps, approval("e1", "epic-1"));
    const result = await pushWatchEvent(h.deps, resolved("e1", "epic-1"));
    expect(result).toEqual({ kind: "corrected", eventId: "e1" });

    const reRaised = await pushWatchEvent(h.deps, approval("e1", "epic-1"));
    expect(reRaised.kind).toBe("sent");
  });
});

describe("an epic with no bound conversation", () => {
  it("drops the notification, warns, and does NOT record it as sent", async () => {
    /*
     * Not recording it is the load-bearing half: if a conversation is bound
     * later, the still-pending approval must still be able to notify. A
     * `no-route` written into the sent-set would suppress it forever.
     */
    const h = harness(new FakeStore([]), succeeds);
    const result = await pushWatchEvent(h.deps, approval("e1", "epic-unbound"));

    expect(result).toEqual({ kind: "no-route", epicId: "epic-unbound" });
    expect(h.sends.length).toBe(0);
    expect(h.store.hasSent("e1")).toBe(false);
    expect(h.warnings.length).toBe(1);
  });
});
