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
  | { readonly kind: "unknown"; readonly status: number }
  /**
   * **We never got an answer at all** — DNS, TLS, a timeout, an abort. There
   * is no status to classify, and this is the one case the status-based
   * union above structurally could not express.
   *
   * Kept distinct from `unknown` rather than folded into it with a sentinel
   * status: `{ kind: "unknown", status: 0 }` reads, in a log and to the next
   * reader, as *"Bot Service replied 0"* — a claim about a response that
   * never existed. `unknown` means **they said something we don't
   * recognise**; `unreachable` means **they said nothing**. Different
   * diagnoses, different fixes, and only an absent field makes a reader ask.
   *
   * Disposal rule is the same as `auth` and for the same reason: a network
   * blip must never delete a conversation reference.
   */
  | { readonly kind: "unreachable"; readonly detail: string };

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

/**
 * What actually came back from `adapter.continueConversation(...)`.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE SEND PATH HAS NO STATUS CODE TO CLASSIFY. THIS FINDS ONE, OR SAYS SO.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * {@link classifySendFailure} takes a `number`, and the design that
 * specified it assumed the send would hand one back. **It does not.**
 * `CloudAdapter.continueConversation` is typed `Promise<void>`: it resolves
 * with nothing on success and *throws* on failure. So there is no status at
 * the call site, and the 403-vs-401 distinction — the highest-consequence
 * one in this path — has nothing to operate on unless it is recovered from
 * the thrown value.
 *
 * It is recoverable, but only for HTTP failures. The SDK's `HttpError`
 * carries `readonly status: number` (`@microsoft/agents-hosting`'s
 * `httpClient.d.ts`), and its connector client throws that instance through.
 * A DNS failure, a TLS failure, a timeout or an abort throws something else
 * entirely, with no status anywhere on it — which is why `unreachable`
 * exists.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THE STATUS IS READ STRUCTURALLY RATHER THAN VIA `instanceof HttpError`
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Same reason `state/conversation-reference-store.ts` persists a structural
 * subset rather than the SDK's type: an `instanceof` against a dependency's
 * class is a silent-failure risk across a version bump or a duplicated copy
 * of the package in the tree, and it fails in the direction that *keeps* a
 * dead reference or *drops* a live one. A numeric `status` on the error is
 * the actual contract we depend on, so that is what is checked.
 *
 * Note the deliberate asymmetry: an error with no readable status returns
 * `unreachable`, never a guess. Guessing `auth` would mask an uninstall
 * forever; guessing `gone` would delete state on a flaky network. **Neither
 * wrong answer is recoverable, so the honest one is "we do not know".**
 */
export function outcomeOfSendError(error: unknown): SendOutcome {
  const detail = error instanceof Error ? error.message : String(error);

  if (error !== null && typeof error === "object" && "status" in error) {
    const { status } = error;
    // `Number.isInteger` on top of the `typeof` guard, not instead of it:
    // NaN passes `typeof === "number"`, and `classifySendFailure(NaN)` would
    // fall through to `unknown` carrying a NaN status — a value that prints
    // as "unknown status NaN" and tells nobody anything. An unreadable
    // status is the `unreachable` case, which says something true.
    if (typeof status === "number" && Number.isInteger(status)) {
      return classifySendFailure(status);
    }
  }

  return { kind: "unreachable", detail };
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
