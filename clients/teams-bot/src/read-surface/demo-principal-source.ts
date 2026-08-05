import { isCanonicalGuid } from "@traycer-clients/shared/identity-registry/guid";
import type { VerifiedAadObjectId } from "@traycer-clients/shared/identity-registry/types";
import { logWarn } from "../logger";
import type { ResolvePrincipal } from "./principal-source";

/**
 * ⚠️ TEMPORARY, DELIBERATE SECURITY SCOPE CUT — DELETE WHEN T1b LANDS.
 *
 * Approved explicitly by the user on 2026-07-30 to make a demo possible
 * before T1b (Teams SSO token exchange) exists, on exactly these terms:
 *
 *   1. The principal comes from CONFIG/ENV ONLY.
 *   2. `activity.from.aadObjectId` — or any other activity-body field — is
 *      still FORBIDDEN as an identity source. That refusal stands and was
 *      NOT overridden.
 *   3. It refuses to activate unless {@link DEMO_IDENTITY_ENV_FLAG} is
 *      explicitly set to "1".
 *   4. It is deleted when T1b lands. See the epic decision log.
 *
 * WHAT THIS HONESTLY IS, stated plainly rather than dressed up: A2's
 * `aad-id-token.ts` is the sole legitimate mint point for
 * `VerifiedAadObjectId`, and its docblock says a cast anywhere else "is a
 * security bypass, not a workaround." This file performs exactly that cast.
 * It is a *sanctioned* bypass, not a clean one — the only things making it
 * defensible are that the value comes from operator-controlled config
 * rather than from an attacker-shaped request, that it cannot switch on
 * without an explicit env flag, and that it has a removal trigger.
 *
 * WHAT IT DOES NOT DO: it does not weaken the Bot Framework Connector JWT
 * validation on the inbound endpoint (`auth/bot-framework-jwt.ts`). That
 * remains fully enforced — every inbound activity is still Microsoft-signed
 * and verified. This affects only *which Traycer tenant* a verified request
 * is attributed to, and in single-user demo mode there is exactly one
 * configured answer.
 *
 * WHAT IT COSTS: while this is active, the bot cannot distinguish two
 * Teams users. Every inbound activity resolves to the one configured
 * principal. That is acceptable for a single-user demo and is NOT
 * acceptable for the multi-tenant deployment this epic is ultimately for —
 * which is precisely why T1b, not this, is the real answer.
 */

export const DEMO_IDENTITY_ENV_FLAG = "TRAYCER_TEAMS_DEMO_IDENTITY";
export const DEMO_IDENTITY_OID_ENV = "TRAYCER_TEAMS_DEMO_OID";

export type DemoPrincipalSourceResult =
  | { readonly kind: "inactive" }
  | { readonly kind: "active"; readonly resolve: ResolvePrincipal }
  | { readonly kind: "misconfigured"; readonly reason: string };

/**
 * Returns `inactive` unless the flag is explicitly "1" — so simply having
 * this file in the tree changes nothing about how the bot behaves.
 * Misconfiguration (flag on, oid missing or not a canonical GUID) is a
 * `misconfigured` result the caller must treat as fatal, never a silent
 * fallback to some other identity.
 */
export function createDemoPrincipalSource(
  env: NodeJS.ProcessEnv,
): DemoPrincipalSourceResult {
  if (env[DEMO_IDENTITY_ENV_FLAG] !== "1") {
    return { kind: "inactive" };
  }

  // Deliberately NOT trimmed. Trimming would itself be a normalisation,
  // which contradicts the refuse-don't-normalise rule below — a leading
  // space would be silently "fixed" into a valid identity. Matches A2's own
  // `registry-config.ts`, whose `isCleanNonEmpty` requires
  // `value === value.trim()` rather than trimming for you.
  const rawOid = env[DEMO_IDENTITY_OID_ENV];
  if (rawOid === undefined || rawOid.trim().length === 0) {
    return {
      kind: "misconfigured",
      reason: `${DEMO_IDENTITY_ENV_FLAG}=1 but ${DEMO_IDENTITY_OID_ENV} is not set — refusing to start rather than guessing an identity.`,
    };
  }
  // Same canonical-GUID rule A2's real mint point enforces, and for the
  // same reason: refuse a non-canonical value rather than normalising it,
  // so this path can never introduce a case-collapse the registry's own
  // uniqueness rules exist to reject. The pattern is anchored, so a value
  // with surrounding whitespace fails here rather than being accepted.
  if (!isCanonicalGuid(rawOid)) {
    return {
      kind: "misconfigured",
      reason: `${DEMO_IDENTITY_OID_ENV} is not a canonical lowercase GUID — refusing rather than normalising it.`,
    };
  }

  // THE SANCTIONED CAST. See this module's docblock. Do not copy this
  // pattern anywhere else; every other consumer must obtain a
  // `VerifiedAadObjectId` from `validateAadIdToken`.
  const oid = rawOid as VerifiedAadObjectId;

  const resolve: ResolvePrincipal = async () => {
    // Logged on EVERY resolution, not once at startup: an operator reading
    // logs during the demo should be unable to miss that identity is
    // config-asserted rather than token-verified.
    logWarn(
      "DEMO IDENTITY ACTIVE — principal is config-asserted, not token-verified",
      {
        flag: DEMO_IDENTITY_ENV_FLAG,
        oid,
      },
    );
    return { kind: "resolved", principal: { kind: "entra", oid } };
  };

  return { kind: "active", resolve };
}
