/**
 * The lifecycle of one owner action, as the UI must represent it.
 *
 * THREE WORDING CONSTRAINTS, all pointing the same way, and the type name
 * argues against all three:
 *
 * 1. Do not flip the row on send. The ack proves the host PROCESSED the
 *    frame, never that it DID anything new — a duplicate approve acks
 *    `accepted` too. Optimistic rendering here is the most consequential
 *    fake progress in the app: a user walks away believing they approved
 *    something they did not.
 *
 * 2. `failed` means UNCONFIRMED, not "did not apply". The frame may have
 *    landed with no way for this process to learn it did, so "this didn't
 *    happen" is a FALSE statement rather than a pessimistic one.
 *
 * 3. Accurate is not enough — be ACTIONABLE. "We couldn't confirm this"
 *    leaves the user stuck on "so do I click it again?". The honest answer
 *    is look first: a second approve is safe at the host but tells you
 *    nothing new, because a duplicate acks `accepted` either way.
 *
 * Settlement comes from `ActionTracker`, which resolves on a correlated ack
 * or the item's absence from a fresh post-reconnect snapshot — never on the
 * ack alone. See `@traycer-clients/shared/host-client/action-tracker`.
 */

export type ActionPhase =
  /** Nothing sent. Buttons live. */
  | { readonly kind: "idle" }
  /**
   * Sent, not settled. Buttons DISABLED — a second click would mint a second
   * `clientActionId` and a second frame for the same decision.
   */
  | { readonly kind: "pending"; readonly verb: string }
  /** Confirmed by a real signal, not by the ack. */
  | { readonly kind: "applied" }
  /** The host said no. Distinct from unconfirmed: this is an answer. */
  | { readonly kind: "rejected"; readonly reason: string | null }
  /** UNCONFIRMED. May have applied. See constraint 2. */
  | { readonly kind: "unconfirmed"; readonly reason: string };

/**
 * The line shown for a phase.
 *
 * Written here rather than inline so the three constraints live next to the
 * words they govern — the tracker's docblock explains the mechanism, and this
 * is where someone editing copy will actually look.
 */
export function actionPhaseMessage(phase: ActionPhase): string | null {
  switch (phase.kind) {
    case "idle":
      return null;
    case "pending":
      // Present continuous, deliberately: it says an attempt is in flight and
      // claims no outcome.
      return `${phase.verb}…`;
    case "applied":
      return "Done.";
    case "rejected":
      return phase.reason === null
        ? "The host declined this."
        : `The host declined this: ${phase.reason}`;
    case "unconfirmed":
      // NEVER "this didn't happen" — see constraint 2. And it ends with what
      // to do, not just what is true.
      return "Couldn’t confirm this. It may have gone through — check the chat before deciding again.";
  }
}

/** Buttons are live only when nothing is in flight and nothing has settled. */
export function actionsEnabled(phase: ActionPhase): boolean {
  return phase.kind === "idle" || phase.kind === "unconfirmed";
}
