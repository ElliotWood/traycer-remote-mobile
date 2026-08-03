/**
 * Which `bridge watch` events should interrupt someone, and which stop
 * counting as already-sent.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THIS IS NOT THE FUNCTION THE T4 DESIGN SPECIFIED, AND THE SOURCE IS WHY
 * ─────────────────────────────────────────────────────────────────────────
 *
 * The design said: filter host notification entries through `BLOCKING_KINDS`
 * (via `toAttentionItems`) and drop anything already sent. **Reading the real
 * emission changed two of those three clauses.**
 *
 *   THE KIND FILTER IS ALREADY APPLIED, at the producer. `WatchEventKind` is
 *   `"approval.requested" | "interview.requested"` — the union cannot express
 *   a non-blocking kind, so re-filtering here would be a second copy of a
 *   decision, which is the exact defect the design argued against. Applying
 *   `BLOCKING_KINDS` again would look diligent and be a divergence risk.
 *
 *   RESOLUTION IS NOW OBSERVABLE, and it must be consumed. `bridge watch`
 *   emits `resolved` because "stopped appearing" is not derivable from a
 *   stream of snapshots — a resolved approval and a dropped subscription are
 *   identical downstream. That signal did not exist when the design was
 *   written, and the design assumed it did.
 *
 * Only the third clause survived: dedupe on a stable id.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY `resolved` MUST FORGET, NOT MERELY BE IGNORED
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `approvalEventId` is `approval.requested:<chatId>:<approvalId>`, and its
 * docblock says a re-raised approval carries a NEW approvalId — so a re-raise
 * is genuinely a new event. But an agent can raise the same approval id again
 * after a resolve in other flows, and a sent-set that never forgets would
 * silently swallow the second ask.
 *
 * **A notification not sent because of a stale bookkeeping entry is
 * indistinguishable, to the user, from an agent that never asked.** So a
 * `resolved` event drops its id from the set: the bookkeeping only ever
 * covers things currently outstanding.
 */
import type { WatchEvent } from "../adapters/watch-events";

export interface SelectPushableArgs {
  /** One tick's worth of `bridge watch` lines, in emission order. */
  readonly events: readonly WatchEvent[];
  /**
   * Event ids already pushed. Explicit rather than defaulted: an empty set
   * and a forgotten argument look identical at the call site, and one of them
   * re-notifies everything.
   */
  readonly alreadySent: ReadonlySet<string>;
}

export interface PushPlan {
  /** `appeared` events not yet sent, in emission order. */
  readonly push: readonly WatchEvent[];
  /**
   * The sent-set as it should be AFTER acting: previous ∪ pushed ∖ resolved.
   *
   * Returned whole rather than as a pair of deltas, so a caller cannot apply
   * one and forget the other — which would either re-notify everything or
   * never forget anything, and both are silent.
   */
  readonly nextSent: ReadonlySet<string>;
}

export function selectPushable(args: SelectPushableArgs): PushPlan {
  const next = new Set(args.alreadySent);
  const push: WatchEvent[] = [];

  for (const event of args.events) {
    if (event.type === "resolved") {
      next.delete(event.eventId);
      continue;
    }
    // Order matters within a tick: an `appeared` for an id resolved EARLIER in
    // the same tick is a genuine re-raise and must push. Processing the tick
    // in emission order rather than partitioning by type is what preserves
    // that; partitioning would drop it.
    if (next.has(event.eventId)) continue;
    next.add(event.eventId);
    push.push(event);
  }

  return { push, nextSent: next };
}
