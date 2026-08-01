/**
 * The state of a create, and — the point of this module — WHAT TO TELL
 * SOMEONE WHOSE CREATE DID NOT COME BACK.
 *
 * The two creates in this client look identical on screen and need opposite
 * advice, because the difference is in the protocol and nowhere else:
 *
 *   epic.createChat      `chatId` is CLIENT-supplied and the host resolver is
 *                        idempotent on it. Resending the identical request
 *                        cannot make a second chat. → PRESS IT AGAIN.
 *
 *   epic.createArtifact  takes no client id; `artifactId` exists only in the
 *                        response, and the schema carries no dedupe rule. A
 *                        retry is a second artifact. → GO AND LOOK FIRST.
 *
 * These were one shared `CreatePhase` rendering one message. That is a trap:
 * the correct wording is a property of the RPC contract, and a component
 * cannot see which contract it is eventually wired to. The advice therefore
 * travels WITH the phase, decided where the call is made, so a surface cannot
 * quietly inherit the wrong one — which already happened once, when the agent
 * form told people to go and verify something they could simply have retried.
 *
 * The consequential direction is worth naming: telling someone to retry when
 * it duplicates creates junk in their epic. Telling someone to verify when
 * they could retry only wastes their time. Neither is acceptable, but if this
 * is ever unclear for a new call, DEFAULT TO "verify" — read the contract,
 * and only claim retry-safety when the schema says so.
 */

/** Whether repeating the identical request is safe. Read from the contract. */
export type RetrySafety =
  /** The host dedupes on a client-supplied id. */
  | "idempotent"
  /** No client id, no dedupe rule — a retry creates a duplicate. */
  | "may-duplicate";

export type CreatePhase =
  | { readonly kind: "idle" }
  | { readonly kind: "submitting" }
  /** UNCONFIRMED, not "failed" — the request may have landed. */
  | {
      readonly kind: "unconfirmed";
      readonly reason: string;
      readonly retry: RetrySafety;
    };

/**
 * The sentence shown after an unconfirmed create.
 *
 * Named for the ACTION rather than the state, because the action is the part
 * that differs and the part a reader needs to check against the contract.
 */
export function retryAdvice(retry: RetrySafety, thing: string): string {
  return retry === "idempotent"
    ? `Press the button again — it’s the same request, so it can’t make a second ${thing}.`
    : `It may already exist. Check the list before creating another ${thing}, or you’ll end up with two.`;
}
