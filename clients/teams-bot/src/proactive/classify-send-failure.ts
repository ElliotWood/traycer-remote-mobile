/**
 * What a failed proactive send means, and whether to discard the conversation.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 403 AND 401 LOOK IDENTICAL AND HAVE OPPOSITE CORRECT RESPONSES
 * ─────────────────────────────────────────────────────────────────────────
 *
 * This is the highest-consequence distinction in the proactive path.
 *
 *   403  the app was uninstalled, or the bot removed from the conversation.
 *        THEIR state changed. **Delete the stored reference** — retrying
 *        forever against an uninstall is how a bot gets throttled, and the
 *        reference will never work again.
 *
 *   401  our token or credentials are wrong. OUR defect. **Keep the
 *        reference.** Deleting here destroys state to hide a bug we caused,
 *        and a credential expiry would silently wipe every conversation
 *        reference on the box — self-inflicted data loss, in a code path with
 *        nobody watching.
 *
 * Both surface as "the send didn't work". Collapsing them into one error
 * branch is the defect, and it is the branch that passes vacuously if a test
 * only asserts "it returned an error".
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 202 IS NOT DELIVERY
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Bot Service returns `202 Accepted` when it has QUEUED the activity. There
 * is no delivery receipt — not deferred, **unavailable**. So `202` is
 * classified as `queued` rather than `delivered`, and the store records
 * `sentAt` and never `deliveredAt`: **a field we cannot populate truthfully
 * should not exist.** An absent field makes a reader ask; a plausible one
 * stops them.
 */

export type SendOutcome =
  /** Queued by Bot Service. NOT delivered — no receipt exists. */
  | { readonly kind: "queued" }
  /**
   * The conversation is gone for good. Drop the reference.
   * `reason` distinguishes the two ways that happens, because they read
   * differently in a log and one of them is a user action.
   */
  | { readonly kind: "gone"; readonly reason: "uninstalled" | "not-found" }
  /** OUR problem. Keep the reference; fix the credential. */
  | { readonly kind: "auth" }
  /** Throttled. The reference is fine; back off and retry. */
  | { readonly kind: "throttled" }
  /**
   * Anything else. Deliberately NOT merged into `auth` or `gone` — an
   * unrecognised status must not inherit either one's disposal rule, because
   * one of them deletes state.
   */
  | { readonly kind: "unknown"; readonly status: number };

/**
 * Whether this outcome means the stored conversation reference is dead.
 *
 * Exposed as its own function rather than left to each call site to infer
 * from the union: **"should I delete state?" is the question the 403/401
 * distinction exists to answer**, and a call site that re-derives it can get
 * it wrong privately. Only `gone` returns true — `unknown` deliberately does
 * not, because deleting on a status nobody has classified is how a transient
 * upstream error becomes permanent data loss.
 */
export function shouldDiscardReference(outcome: SendOutcome): boolean {
  return outcome.kind === "gone";
}

export function classifySendFailure(status: number): SendOutcome {
  switch (status) {
    case 200:
    case 201:
    case 202:
      return { kind: "queued" };
    case 401:
      return { kind: "auth" };
    case 403:
      return { kind: "gone", reason: "uninstalled" };
    case 404:
      return { kind: "gone", reason: "not-found" };
    case 429:
      return { kind: "throttled" };
    default:
      return { kind: "unknown", status };
  }
}
