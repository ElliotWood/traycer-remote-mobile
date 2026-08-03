/**
 * Where a proactive notification goes, and what has already been sent.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * TWO STORES, BECAUSE THEY ANSWER TWO QUESTIONS WITH DIFFERENT LIFETIMES
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   TARGETS  epicId → conversation reference. Long-lived; changes only when
 *            someone installs, uninstalls, or rebinds. Deleting one is a
 *            real decision (see `shouldDiscardReference`).
 *
 *   SENT     eventId → when we sent it. Short-lived by nature; an entry is
 *            forgotten the moment the thing it refers to is resolved.
 *
 * Keeping them in one map would make "forget this notification" and "forget
 * this conversation" the same call, and they are emphatically not.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY NOT `read-surface/epic-binding-store.ts`
 * ─────────────────────────────────────────────────────────────────────────
 *
 * It binds the other direction (conversation → epic), it is in-memory, and
 * its own header says so in capitals, ending: *"the same shape of problem
 * T4's proactive conversation-reference store will need … replace it
 * deliberately when T4 needs a real one."* This is that replacement for the
 * proactive direction. The read-surface binding is untouched — it is
 * per-turn state answering "which epic is this chat talking about", which is
 * a genuinely different question and correctly dies with the process.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY NOT `state/conversation-reference-store.ts`
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Right mechanism, wrong key. That store is keyed by WORK ID — one RFI
 * assessment, one reply target, `forget()` once the reply lands. A proactive
 * target is keyed by EPIC and is not consumed by being used: the same epic
 * notifies many times. Reusing it would make the first notification delete
 * the route for the second.
 *
 * Its `StoredConversationReference` type IS reused, deliberately — the
 * on-disk shape of "where do I send this" should not fork.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * `sentAt`, AND NO `deliveredAt`
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Bot Service returns `202 Accepted` — queued, not delivered — and offers no
 * delivery receipt. Not deferred: **unavailable.** So there is no
 * `deliveredAt` field, because a field we cannot populate truthfully should
 * not exist. An absent field makes a reader ask; a plausible one stops them.
 *
 * This same store carries the ROUTING caveat from
 * `state/conversation-reference-store.ts` verbatim: a reference holds
 * `user.aadObjectId`, and reading it back out as an identity or
 * authorisation source is forbidden. It answers "where do I send this" and
 * nothing else.
 */
import { DurableJsonStore } from "../state/durable-json-store";
import type { StoredConversationReference } from "../state/conversation-reference-store";

export interface ProactiveTarget {
  readonly reference: StoredConversationReference;
  /** When this epic was bound to that conversation. */
  readonly boundAt: number;
}

export interface SentRecord {
  /**
   * When the send was ACCEPTED by Bot Service. Never when it arrived — see
   * the header. There is deliberately no sibling field.
   */
  readonly sentAt: number;
}

export interface ProactiveStore {
  /** Where notifications for this epic go, or `null` if nowhere. */
  targetFor(epicId: string): ProactiveTarget | null;
  bindTarget(epicId: string, reference: StoredConversationReference, boundAt: number): void;
  /**
   * Drop the route for an epic. Called ONLY on a `gone` outcome — the 403
   * branch. Every other failure keeps it.
   */
  discardTarget(epicId: string): void;
  /** Epics we currently hold a route for. */
  boundEpics(): readonly string[];

  /** Whether this exact event has already been accepted by Bot Service. */
  hasSent(eventId: string): boolean;
  recordSent(eventId: string, sentAt: number): void;
  /**
   * Forget an event id, so a re-raise of the same id notifies again.
   *
   * **A notification not sent because of a stale bookkeeping entry is
   * indistinguishable, to the user, from an agent that never asked.** So the
   * sent-set only ever covers things currently outstanding, and a `resolved`
   * event clears its entry.
   */
  forgetSent(eventId: string): void;
  sentEventIds(): readonly string[];
}

export class DurableProactiveStore implements ProactiveStore {
  private readonly targets: DurableJsonStore<ProactiveTarget>;
  private readonly sent: DurableJsonStore<SentRecord>;

  /**
   * Two explicit paths rather than one directory plus derived names: the
   * caller of a store that survives restarts should be able to see, at the
   * call site, exactly which files it owns.
   */
  constructor(
    targetsFilePath: string,
    sentFilePath: string,
    onWarn: ((message: string, detail: string) => void) | undefined,
  ) {
    this.targets = new DurableJsonStore<ProactiveTarget>({
      filePath: targetsFilePath,
      onWarn,
    });
    this.sent = new DurableJsonStore<SentRecord>({
      filePath: sentFilePath,
      onWarn,
    });
  }

  targetFor(epicId: string): ProactiveTarget | null {
    return this.targets.get(epicId);
  }

  bindTarget(
    epicId: string,
    reference: StoredConversationReference,
    boundAt: number,
  ): void {
    this.targets.set(epicId, { reference, boundAt });
  }

  discardTarget(epicId: string): void {
    this.targets.delete(epicId);
  }

  boundEpics(): readonly string[] {
    return this.targets.keys();
  }

  hasSent(eventId: string): boolean {
    return this.sent.get(eventId) !== null;
  }

  recordSent(eventId: string, sentAt: number): void {
    this.sent.set(eventId, { sentAt });
  }

  forgetSent(eventId: string): void {
    this.sent.delete(eventId);
  }

  sentEventIds(): readonly string[] {
    return this.sent.keys();
  }
}
