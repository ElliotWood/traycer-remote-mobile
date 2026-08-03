/**
 * M2 item 3 — what the composer's rate-limit banner should say, as a pure
 * function of the profiles the client already holds.
 *
 * There is NO rate-limit signal on `chat.subscribe` (verified: zero matches
 * for `rateLimit` in `agent/gui/subscribe.ts`), so this is derived entirely
 * client-side from `providers.list`, which mobile already polls.
 *
 * ## Rate-limit state is three-valued, on two independent axes
 *
 * The M2 ticket is written against a two-valued model and gets two things
 * wrong as a result. Both are one framing error, so both are fixed here rather
 * than patched separately.
 *
 * `rateLimitStatus`: `ok` | `near_limit`/`hard_limit` | **`unknown`**.
 * `rateLimitLimitedScopes`: `null` (no per-scope data — fall back to the
 * profile-level status) | `[]` (**read fine, nothing limited — HEALTHY**) |
 * `[{family, severity}]` (these windows are limited; `family: null` is a
 * shared window gating every model).
 *
 * The ticket says "empty ⇒ profile-wide, generic copy". Empty means healthy.
 * Built literally, a healthy account renders a limit banner — and on the live
 * host, two of three profiles carry `[]`, so it would have fired immediately
 * on accounts with nothing wrong. `effectiveProfileRateLimitSeverity` already
 * encodes the correct reading; this module defers to it rather than
 * re-deriving.
 *
 * ## The two reads are NOT interchangeable
 *
 * - `effectiveProfileRateLimitSeverity` — the WARNING side. Unknown and
 *   healthy both mean "don't warn". Used for {@link deriveRateLimitBanner}'s
 *   severity.
 * - `assessProfileRateLimit` — the DESTINATION side, returning `{known:false}`
 *   for unknown. Used for ranking switch targets, and **only** there.
 *
 * They are one function name apart and the difference is invisible in review.
 * Rank with the warning-side read and a never-read profile scores as healthy,
 * so the phone confidently recommends switching to an account that may be
 * equally exhausted — the same confidently-wrong failure this ticket exists to
 * fix, moved to the destination side.
 */
import type { GuiAgentModelOption } from "@traycer/protocol/host/agent/gui/unary-schemas";
import type { ProviderProfile } from "@traycer/protocol/host/provider-schemas";
import {
  assessProfileRateLimit,
  effectiveProfileRateLimitSeverity,
  matchingRateLimitScopes,
  rateLimitSeverityTier,
  type ProfileRateLimitSeverity,
} from "@traycer-clients/shared/rate-limits/rate-limit-scope-match";
import {
  profileCommitId,
  profileDisplayLabel,
} from "@traycer-clients/shared/providers/provider-profile-model";

export interface RateLimitSwitchTarget {
  /** Commit id — `null` for ambient, never the wire sentinel. */
  readonly profileId: string | null;
  readonly label: string;
}

export interface RateLimitBannerState {
  readonly severity: ProfileRateLimitSeverity;
  /** The current profile's display label, so the banner can name the account. */
  readonly currentLabel: string;
  /**
   * Model families the limit applies to. EMPTY means profile-wide — either the
   * host reported no per-scope data, or it reported a scope with `family:
   * null` (a shared window gating every model). Callers render generic copy
   * for empty, and never try to name a family that isn't there.
   */
  readonly limitedFamilies: readonly string[];
  /** A concrete, strictly-better profile to switch to, or `null` for the terminal state. */
  readonly switchTarget: RateLimitSwitchTarget | null;
  /**
   * Identifies this warning episode for dismissal. Changes when the profile or
   * severity changes, so dismissing a `near_limit` warning does not also
   * suppress the `hard_limit` that follows it.
   */
  readonly episodeKey: string;
}

/**
 * Whether `candidate` is a defensible place to send the user, given the
 * current profile's severity.
 *
 * `known: false` returns false unconditionally. That is the whole point of the
 * destination-side read: a profile whose gauge was never read, went stale, or
 * last probed with a failure is INCOMPARABLE, not healthy, and must never
 * satisfy a "strictly better" test no matter how limited the current profile
 * is. Offering it would be a guess wearing a recommendation.
 */
export function isBetterSwitchTarget(
  candidate: ProviderProfile,
  currentSeverity: ProfileRateLimitSeverity,
  model: GuiAgentModelOption | null,
): boolean {
  const assessment = assessProfileRateLimit(candidate, model);
  if (!assessment.known) return false;
  return (
    rateLimitSeverityTier(assessment.severity) <
    rateLimitSeverityTier(currentSeverity)
  );
}

/**
 * The families a profile's limit applies to — `[]` when the limit is
 * profile-wide.
 *
 * Both "no per-scope data" (`null`) and "a scope with no family" collapse to
 * empty here, because they mean the same thing to a reader: everything is
 * affected and there is nothing specific to name.
 */
function limitedFamiliesFor(
  profile: ProviderProfile,
  model: GuiAgentModelOption | null,
): readonly string[] {
  const scopes = matchingRateLimitScopes(profile, model);
  if (scopes === null) return [];
  const named = scopes
    .map((scope) => scope.family)
    .filter((family): family is string => family !== null);
  return [...new Set(named)];
}

/**
 * The banner to show, or `null` for "say nothing".
 *
 * `null` covers healthy, unknown, and no-current-profile alike — the warning
 * side does not distinguish them, because none of them is a reason to alarm
 * someone.
 */
export function deriveRateLimitBanner(args: {
  readonly profiles: readonly ProviderProfile[];
  /** The chat's committed `ChatRunSettings.profileId`: `null` is ambient. */
  readonly currentProfileId: string | null;
  readonly model: GuiAgentModelOption | null;
}): RateLimitBannerState | null {
  const current = args.profiles.find(
    (p) => profileCommitId(p) === args.currentProfileId,
  );
  if (current === undefined) return null;

  const severity = effectiveProfileRateLimitSeverity(current, args.model);
  if (severity === null) return null;

  const target =
    args.profiles
      .filter((p) => profileCommitId(p) !== args.currentProfileId)
      .find((p) => isBetterSwitchTarget(p, severity, args.model)) ?? null;

  return {
    severity,
    currentLabel: profileDisplayLabel(current),
    limitedFamilies: limitedFamiliesFor(current, args.model),
    switchTarget:
      target === null
        ? null
        : { profileId: profileCommitId(target), label: profileDisplayLabel(target) },
    // Severity is part of the key so a dismissed `near_limit` does not
    // suppress the `hard_limit` that follows — those are different warnings
    // about different urgencies.
    episodeKey: `${args.currentProfileId ?? "ambient"}:${severity}`,
  };
}
