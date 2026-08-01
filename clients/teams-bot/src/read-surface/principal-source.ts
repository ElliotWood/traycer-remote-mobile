import type { VerifiedPrincipal } from "@traycer-clients/shared/identity-registry/types";

/**
 * The seam between an inbound Teams activity and a *verified* principal.
 *
 * THERE IS DELIBERATELY NO IMPLEMENTATION IN THIS FILE. The only legitimate
 * production implementation is T1b's Teams SSO token exchange, which
 * obtains a real Entra ID token and passes it to A2's `validateAadIdToken`
 * — the sole mint point for `VerifiedAadObjectId`. T1b is blocked on T0c
 * (the bot App ID, on the user's admin lead time).
 *
 * WHAT MUST NEVER IMPLEMENT THIS INTERFACE: anything reading
 * `activity.from.aadObjectId`. That field is inside the request body Bot
 * Service relays, is not cryptographically bound to anything, and A2's
 * registry forbids it by name. It looks equivalent to `oid` and
 * structurally cannot provide the same guarantee. If you are here because
 * you need "just something that works for a demo", that is a scope
 * decision for the user to make explicitly — not a shortcut to take
 * because this interface happens to be easy to satisfy.
 *
 * Typed as a per-turn resolver so a real SSO implementation (which needs
 * an invoke round-trip against the turn) can close over whatever it needs,
 * while callers of the read surface stay testable without a `TurnContext`.
 */
export type PrincipalResolution =
  | { readonly kind: "resolved"; readonly principal: VerifiedPrincipal }
  | { readonly kind: "unavailable"; readonly reason: string };

export type ResolvePrincipal = () => Promise<PrincipalResolution>;
