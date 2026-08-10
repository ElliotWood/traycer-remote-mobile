/**
 * T4 step 3 — the send path, thin, over steps 1 and 2.
 *
 * One `bridge watch` event in; at most one proactive message out; the stores
 * left in a state that is correct after a crash at any point.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE ORDERING DECISION THIS FILE EXISTS TO GET RIGHT
 * ─────────────────────────────────────────────────────────────────────────
 *
 * **The sent-set is written AFTER a successful send, never before.**
 *
 * Writing it first is the tempting order — it makes the function idempotent
 * against its own retry and reads as the careful choice. It is the wrong
 * one. If the send then fails on a credential blip or a 429, the event is
 * marked sent forever and **the user is never told an agent is blocked.**
 * The failure is permanent, silent, and indistinguishable from an agent that
 * never asked.
 *
 * The opposite ordering can only produce a DUPLICATE card, on the narrow
 * window where the send is accepted and the process dies before the write.
 * A duplicate is visible, annoying, and self-correcting. A swallowed
 * approval is none of those things. **When one failure mode is silent and
 * the other is loud, take the loud one.**
 *
 * Only `queued` records. `auth`, `throttled`, `unreachable` and `unknown`
 * all leave the event unsent so the next tick retries it — which is correct
 * for all four, because none of them means the user saw anything.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS BOT DE-DUPLICATES AT ALL, GIVEN THE BRIDGE ALREADY DOES
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `bridge watch` emits a diff, so a still-pending approval is not re-sent
 * every four seconds. That solves the producer's half. It does not solve
 * ours: the bridge's tracker is **process-lifetime**, so a bridge restart
 * re-announces every open approval — correctly, having no way to know what
 * this bot already did with them. Our set is durable and answers the other
 * half. Both are needed and they are not the same guard.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠ A NOTED DUPLICATION, WITH A NAMED EXIT
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `clients/remote-bridge/src/proactive/select-pushable.ts` implements this
 * same rule — dedupe on a stable id, forget on `resolved`. It has **no
 * caller**: a grep finds only its own test. It is consumer-side logic living
 * in the producer, and the one consumer (this bot) structurally cannot
 * import it — no `remote-bridge` dependency exists, by the deliberate
 * spawned-binary architecture that `watch-line.ts` documents.
 *
 * The correct end state is one copy in `clients/shared`, which this bot
 * already imports from, per the tab plan's extract-on-demand rule. That was
 * NOT done here because `clients/shared` is being actively written in
 * another worktree, and a move in a hot package is a collision. Recorded so
 * this is a deferral with an owner rather than an accretion.
 */
import {
  outcomeOfSendError,
  shouldDiscardReference,
  type SendOutcome,
} from "./classify-send-failure";
import type { ProactiveStore, ProactiveTarget } from "./proactive-store";
import type { WatchEvent } from "./watch-line";

/**
 * Performs the actual Bot Service call.
 *
 * Injected rather than imported so every branch above is testable with no
 * Bot Framework, no network and no Teams — the same property that made
 * steps 1 and 2 verifiable. The real implementation is
 * `send-via-adapter.ts`, and it is deliberately the thinnest thing that can
 * work, because it is the one part of this path that cannot be exercised
 * until T0c unblocks.
 *
 * Contract: resolve on acceptance, THROW on failure. Errors are classified
 * by {@link outcomeOfSendError}, not by the implementation — so a new
 * failure mode is diagnosed in one place.
 */
export type SendProactive = (
  target: ProactiveTarget,
  event: WatchEvent,
) => Promise<void>;

export interface PushDeps {
  readonly store: ProactiveStore;
  /**
   * WHERE THIS EVENT'S NOTIFICATION GOES — and it is per-event, not per-epic.
   *
   * The default is the epic route, which is the general case: any Teams
   * conversation bound to an epic hears about anything blocking in it.
   *
   * It is overridable because there is a MORE PRECISE answer available for
   * chats this bot started. `state/conversation-reference-store.ts` already
   * holds a reference keyed by chat id, written by `start-assessment` before
   * anything that can fail — so an approval in a chat somebody launched from
   * Teams can be routed back to the exact conversation that launched it,
   * rather than to whichever conversation happens to hold the epic.
   *
   * That also means this path works with NO epic route bound at all, which
   * matters while the handler-side binding is owned by another branch: an
   * assessment started from Teams notifies back correctly on its own.
   */
  readonly resolveTarget?: (event: WatchEvent) => ProactiveTarget | null;
  readonly send: SendProactive;
  /** Injected so tests do not depend on the clock. */
  readonly now: () => number;
  readonly onWarn: (message: string, detail: string) => void;
}

export type PushResult =
  /** Sent and accepted. `sentAt` recorded. */
  | { readonly kind: "sent"; readonly eventId: string }
  /** Already in the durable sent-set. No call made. */
  | { readonly kind: "duplicate"; readonly eventId: string }
  /** A `resolved` event we never announced: bookkeeping cleared, nothing sent. */
  | { readonly kind: "forgotten"; readonly eventId: string }
  /**
   * A `resolved` event for something we DID announce. The stale card is
   * corrected in the chat and the bookkeeping cleared. Distinct from
   * `forgotten` because "we told them and then untold them" and "there was
   * nothing to tell" are different facts about the conversation.
   */
  | { readonly kind: "corrected"; readonly eventId: string }
  /**
   * We hold no conversation reference for this epic, so there is nowhere to
   * send. Logged and dropped — NOT recorded as sent, so it will notify if a
   * route appears later.
   */
  | { readonly kind: "no-route"; readonly epicId: string }
  /**
   * The send failed. `outcome` carries which kind, `referenceDiscarded`
   * whether that cost us the route.
   */
  | {
      readonly kind: "failed";
      readonly eventId: string;
      readonly outcome: SendOutcome;
      readonly referenceDiscarded: boolean;
    };

/** The resolver, with the epic route as the documented default. */
function targetOf(deps: PushDeps, event: WatchEvent): ProactiveTarget | null {
  return deps.resolveTarget === undefined
    ? deps.store.targetFor(event.epicId)
    : deps.resolveTarget(event);
}

export async function pushWatchEvent(
  deps: PushDeps,
  event: WatchEvent,
): Promise<PushResult> {
  if (event.type === "resolved") {
    /*
     * CORRECTED, 2026-08-10. This used to clear the bookkeeping and send
     * nothing, on the reasoning that "a resolved approval is not news".
     *
     * That is true in general and false in the one case that matters: WE
     * ALREADY TOLD THEM IT WAS WAITING. Elliot rejected an approval from the
     * CLI and Teams still showed a card saying it needed him — the card
     * cannot refresh itself, because every action this bot emits is
     * `Action.Submit` and Submit has no in-place refresh. So the last thing
     * the user sees is a live-looking request for a decision that was made
     * elsewhere ten minutes ago.
     *
     * A notification that becomes false and stays on screen is worse than no
     * notification: it is the interface asserting something untrue, and the
     * user has no way to tell it from a real one.
     *
     * THE RULE: correct only a claim we actually made. `hasSent` gates it, so
     * a resolution for something we never announced stays silent — there is
     * nothing to correct, and a message about an approval the user never saw
     * is noise that trains them to ignore the channel.
     *
     * NO @-MENTION on this one, deliberately. A tag is a demand for
     * attention; "you no longer need to do the thing" is the opposite of a
     * demand. Tagging here is how a notification channel becomes one people
     * mute — and a muted channel is the same outcome as the bug this whole
     * ticket is fixing.
     *
     * The bookkeeping is cleared EITHER WAY, including when the correction
     * fails to send. Keeping the entry would mean a re-raise of the same id
     * never notifies, and a notification withheld by stale bookkeeping is
     * indistinguishable, to the user, from an agent that never asked.
     */
    const announced = deps.store.hasSent(event.eventId);
    deps.store.forgetSent(event.eventId);
    if (!announced) {
      return { kind: "forgotten", eventId: event.eventId };
    }
    const target = targetOf(deps, event);
    if (target === null) {
      return { kind: "forgotten", eventId: event.eventId };
    }
    try {
      await deps.send(target, event);
    } catch (error) {
      // NOT a `failed` result: nothing is owed to the user beyond a courtesy
      // correction, and the entry is already cleared so a retry would have
      // nothing to key on. Visible in the journal, and that is the right
      // weight for it.
      deps.onWarn(
        "could not correct a notification that is now stale",
        `epicId=${event.epicId} eventId=${event.eventId} error=${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return { kind: "corrected", eventId: event.eventId };
  }

  if (deps.store.hasSent(event.eventId)) {
    return { kind: "duplicate", eventId: event.eventId };
  }

  const target = targetOf(deps, event);
  if (target === null) {
    // Not an error state: an epic nobody has bound a Teams conversation to
    // is the normal case for every epic the user drives from the desktop.
    // Worth a line anyway — "the bot said nothing" has exactly one other
    // explanation and they should be distinguishable in the journal.
    deps.onWarn(
      "no Teams conversation bound to this epic — proactive notification dropped",
      `epicId=${event.epicId} eventId=${event.eventId}`,
    );
    return { kind: "no-route", epicId: event.epicId };
  }

  try {
    await deps.send(target, event);
  } catch (error) {
    const outcome = outcomeOfSendError(error);
    const discard = shouldDiscardReference(outcome);
    if (discard) {
      // 403/404 only. The app was uninstalled or the conversation is gone;
      // retrying forever against an uninstall is how a bot gets throttled.
      deps.store.discardTarget(event.epicId);
    }
    deps.onWarn(
      "proactive send failed",
      `epicId=${event.epicId} eventId=${event.eventId} outcome=${outcome.kind} referenceDiscarded=${String(discard)}`,
    );
    return {
      kind: "failed",
      eventId: event.eventId,
      outcome,
      referenceDiscarded: discard,
    };
  }

  // Accepted — see the header on why this write comes last.
  deps.store.recordSent(event.eventId, deps.now());
  return { kind: "sent", eventId: event.eventId };
}
