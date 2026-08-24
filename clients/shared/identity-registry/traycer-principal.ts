import type { VerifiedPrincipal, VerifiedTraycerUserId } from "./types";

/**
 * The sole mint point for `kind: "traycer"` principals — the browser/PWA
 * routing path's equivalent of `aad-id-token.ts` for the Teams/Entra path.
 *
 * WHY A NETWORK CALL AND NOT A LOCAL SIGNATURE CHECK: Traycer access tokens
 * are JWTs, but this repo has no key with which to verify one, and
 * `clients/shared/auth/jwt-exp.ts` states the governing rule outright — the
 * host (and behind it, Traycer's authn) is the sole authority on token
 * validity: signature, owner binding, and revocation. Decoding a token
 * locally to read an identity out of it would be precisely the forbidden
 * pattern: anyone could mint an unsigned JWT naming another user and be
 * routed to their host. So the identity is obtained by ASKING THE ISSUER,
 * which is the only party that can answer.
 *
 * WHY THE STALENESS/AVAILABILITY TRADE IS ACCEPTABLE HERE: routing is not
 * authorization. See `registry.ts`'s module doc — the host re-validates the
 * same bearer independently, so the worst a stale positive can do is route
 * a revoked token to the host that will reject it. It cannot route anyone
 * to a different tenant. Failure is closed: any non-`valid` outcome
 * (rejected, network error, timeout, malformed body) yields `null`, and
 * `null` is not a `VerifiedPrincipal`, so there is no code path from a
 * failed verification to a resolved tenant.
 *
 * SEAM OBLIGATION: a `VerifiedPrincipal` must be the direct return value of
 * this function (or `validateAadIdToken`), never a cast. The brand is
 * erased at runtime — see `types.ts`.
 */

export type TraycerPrincipalFailure =
  | "rejected"
  | "network_error"
  | "malformed_response"
  /** Refused without calling authn at all — see {@link DEFAULT_MAX_CONCURRENT_VERIFICATIONS}. */
  | "capacity_exhausted";

export type TraycerPrincipalResult =
  | { readonly kind: "verified"; readonly principal: VerifiedPrincipal }
  | { readonly kind: "failed"; readonly reason: TraycerPrincipalFailure };

/** Bounds the outbound call so a hung authn cannot hold a pending connection open indefinitely. */
export const DEFAULT_TRAYCER_VERIFY_TIMEOUT_MS = 10_000;

/**
 * Ceiling on simultaneous in-flight verifications, process-wide.
 *
 * WHY THIS IS NOT OPTIONAL: this function is reached by UNAUTHENTICATED input.
 * Anyone who can open a WebSocket to the ingress can cause one outbound call
 * to Traycer's authn, so without a ceiling the deployment becomes an
 * amplifier pointed at a third party — inbound connections we do not control
 * turning into outbound requests someone else has to absorb. The ingress rate
 * limit bounds this per source address, which is not the same as bounding it
 * in aggregate: distributed sources multiply straight through a per-IP limit.
 *
 * Past the ceiling this fails CLOSED (refuses the connection) rather than
 * queueing. Queueing would convert an abuse burst into unbounded latency and
 * memory on our side, and a refused connection is honest — the client can
 * retry, and a legitimate user is never silently held.
 */
export const DEFAULT_MAX_CONCURRENT_VERIFICATIONS = 32;

/**
 * Module-level because the ceiling must be process-wide: a per-instance
 * counter would be trivially bypassed by anything that constructs more than
 * one caller, which defeats the point of a cap.
 */
let inFlightVerifications = 0;

/** Test-only: asserts the counter is balanced (never leaks a slot on any path). */
export function inFlightVerificationsForTests(): number {
  return inFlightVerifications;
}

export interface VerifyTraycerPrincipalParams {
  readonly bearer: string;
  /** e.g. `https://authn.traycer.ai` — no default; an unset value is a startup failure, not an implicit endpoint. */
  readonly authnBaseUrl: string;
  readonly timeoutMs: number;
  /** Injection seam for tests only — production callers pass the global `fetch`. */
  readonly fetchImpl: typeof fetch;
  /** Process-wide in-flight ceiling; pass {@link DEFAULT_MAX_CONCURRENT_VERIFICATIONS} in production. */
  readonly maxConcurrent: number;
}

/**
 * Resolves the presented bearer to its owning Traycer user id by calling
 * `GET /api/v3/user` — access-only, exactly like
 * `clients/shared/auth/auth-validation.ts`'s
 * `validateAuthTokenIdentityAccessOnly`: no refresh-on-401, so this can
 * never spend a refresh token belonging to the user whose connection it is
 * merely routing.
 */
export async function verifyTraycerPrincipal(
  params: VerifyTraycerPrincipalParams,
): Promise<TraycerPrincipalResult> {
  const { bearer, authnBaseUrl, timeoutMs, fetchImpl, maxConcurrent } = params;
  if (bearer.length === 0) {
    return { kind: "failed", reason: "rejected" };
  }

  // Checked BEFORE the slot is taken and before any network call, so a burst
  // is refused rather than absorbed.
  if (inFlightVerifications >= maxConcurrent) {
    return { kind: "failed", reason: "capacity_exhausted" };
  }
  inFlightVerifications += 1;
  try {
    return await verifyAgainstAuthn(bearer, authnBaseUrl, timeoutMs, fetchImpl);
  } finally {
    // `finally`, not a decrement at each return: this function has six exit
    // paths and can also throw, and a slot leaked on any one of them would
    // wedge the cap permanently closed — turning a DoS guard into a DoS.
    inFlightVerifications -= 1;
  }
}

async function verifyAgainstAuthn(
  bearer: string,
  authnBaseUrl: string,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<TraycerPrincipalResult> {
  let response: Response;
  try {
    response = await fetchImpl(userEndpoint(authnBaseUrl), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${bearer}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    // Transport failure or fired timeout. Fail CLOSED — the caller refuses
    // the connection rather than guessing a tenant.
    return { kind: "failed", reason: "network_error" };
  }

  if (
    response.status === 401 ||
    response.status === 403 ||
    response.status === 404
  ) {
    return { kind: "failed", reason: "rejected" };
  }
  if (response.status < 200 || response.status >= 300) {
    return { kind: "failed", reason: "network_error" };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { kind: "failed", reason: "malformed_response" };
  }

  const userId = readUserId(body);
  if (userId === null) {
    return { kind: "failed", reason: "malformed_response" };
  }
  return {
    kind: "verified",
    principal: { kind: "traycer", userId: userId as VerifiedTraycerUserId },
  };
}

/**
 * Reads `user.id` from the `/api/v3/user` response. Deliberately a total,
 * hand-written decoder rather than a schema import: this module is bundled
 * into the ingress relay, where the smallest possible dependency surface on
 * the security-critical path is worth more than schema reuse.
 */
function readUserId(body: unknown): string | null {
  if (body === null || typeof body !== "object") return null;
  const user = (body as Record<string, unknown>).user;
  if (user === null || typeof user !== "object") return null;
  const id = (user as Record<string, unknown>).id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

function userEndpoint(authnBaseUrl: string): string {
  return new URL(
    "api/v3/user",
    authnBaseUrl.endsWith("/") ? authnBaseUrl : `${authnBaseUrl}/`,
  ).toString();
}
