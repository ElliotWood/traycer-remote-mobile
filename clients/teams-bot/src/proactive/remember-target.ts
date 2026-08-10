/**
 * How an epic ever gets a notification route in the first place.
 *
 * `proactive-store.ts` keys targets by epic and **nothing bound one**, which
 * is the second half of why no approval has ever reached Teams: even with the
 * watcher running, `targetFor` would have returned `null` for every event and
 * `pushWatchEvent` would have logged "no Teams conversation bound to this
 * epic" forever.
 *
 * A route can only be captured on a TURN — the conversation reference exists
 * nowhere else — so this is called from the activity handler. It lives here,
 * not there, for two reasons: the handler is the one file with no unit test,
 * and the idempotence rule below is a decision rather than plumbing.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CALLED ON EVERY TURN, SO IT MUST NOT WRITE ON EVERY TURN
 * ─────────────────────────────────────────────────────────────────────────
 *
 * The natural call site runs for every message in every bound conversation.
 * Writing unconditionally would rewrite a JSON file on each one — and, worse,
 * would move `boundAt` forward constantly, turning a field that means "when
 * this route was established" into one that means "when we last saw a
 * message", silently.
 *
 * So: parse, compare, and return without touching the store when nothing that
 * matters has changed. The guard is HERE rather than at the call site because
 * the caller should not have to know it is needed — a caller who forgets is
 * indistinguishable from one who does not, until someone reads `boundAt`.
 */
import {
  toStoredReference,
  type StoredConversationReference,
} from "../state/conversation-reference-store";
import type { ProactiveStore, ProactiveTarget } from "./proactive-store";

/** What the handler has to hand: `activity.from`, or nothing. */
export interface TurnUser {
  readonly id: string;
  readonly name: string;
}

export type RememberOutcome =
  /** First route for this epic, or a changed one. Written. */
  | { readonly kind: "bound" }
  /** Identical to what we already hold. Nothing written. */
  | { readonly kind: "unchanged" }
  /**
   * The reference did not carry what a proactive send needs. NOT written, and
   * not silent: an epic with no route never notifies, and "the bot said
   * nothing" has exactly one other explanation.
   */
  | { readonly kind: "unusable" };

/**
 * The fields whose change means a genuinely different destination.
 *
 * `capturedAt` is excluded deliberately — it moves on every turn and means
 * "when did we last parse this", which is not a reason to rewrite a route.
 * Including it would make the idempotence check always false and the guard
 * decorative.
 */
function sameDestination(
  a: StoredConversationReference,
  b: StoredConversationReference,
): boolean {
  return (
    a.channelId === b.channelId &&
    a.serviceUrl === b.serviceUrl &&
    a.conversation.id === b.conversation.id &&
    a.bot.id === b.bot.id &&
    a.user?.id === b.user?.id &&
    a.tenantId === b.tenantId
  );
}

function sameMention(
  a: ProactiveTarget["mention"],
  b: ProactiveTarget["mention"],
): boolean {
  return a?.id === b?.id && a?.name === b?.name;
}

/**
 * Records where notifications for `epicId` should go.
 *
 * Synchronous and cheap in the common case: one parse and a field comparison,
 * no disk. Safe to call on every turn.
 *
 * `user` supplies the @-mention. `null` is a legitimate state and costs the
 * tag, not the notification — see `teams/mention.ts` on why an untagged
 * message beats broken markup.
 */
export function rememberProactiveTarget(
  store: ProactiveStore,
  epicId: string,
  rawReference: unknown,
  user: TurnUser | null,
  now: number,
): RememberOutcome {
  const reference = toStoredReference(rawReference, now);
  if (reference === null) return { kind: "unusable" };

  const mention =
    user !== null && user.id.length > 0 && user.name.trim().length > 0
      ? { id: user.id, name: user.name.trim() }
      : undefined;

  const existing = store.targetFor(epicId);
  if (
    existing !== null &&
    sameDestination(existing.reference, reference) &&
    sameMention(existing.mention, mention)
  ) {
    return { kind: "unchanged" };
  }

  store.bindTarget(epicId, {
    reference,
    // Preserved across a re-bind of the SAME destination that only changed its
    // mention: the route was established when it was established, and a
    // display-name change is not a new binding.
    boundAt:
      existing !== null && sameDestination(existing.reference, reference)
        ? existing.boundAt
        : now,
    ...(mention === undefined ? {} : { mention }),
  });
  return { kind: "bound" };
}
