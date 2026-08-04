/**
 * Provider-arm normalisation for a usage surface: one
 * `ProviderRateLimits` snapshot in, a flat `{label, window}[]` out.
 *
 * ## Why this file exists, given `profile-usage-projection.ts` sits beside it
 *
 * They answer different questions and neither substitutes for the other, which
 * is worth stating because a reader who finds two modules named for rate limits
 * in one directory will reasonably assume one is redundant.
 *
 * | | `projectProfileUsage` | this file |
 * | --- | --- | --- |
 * | Input | a `ProviderRateLimitEnvelope` (latest + retained last-good + timestamps) | one `ProviderRateLimits` response |
 * | Answers | "what does the PICKER show for this profile" — one compact window, a severity, a staleness kind | "what are ALL this account's windows, labelled" |
 * | Built for | gui-app's profile dropdown | a usage sheet / usage section |
 *
 * The envelope is the load-bearing difference. **Nothing in `clients/shared`
 * builds one** — `buildProviderRateLimitEnvelope` and
 * `mapResponseToProviderRateLimitEnvelope` stayed in `clients/gui-app` with the
 * TanStack query cache they converge, deliberately, and
 * `provider-rate-limit-envelope.ts`'s own docblock records that react-query
 * "does NOT follow this one into `clients/shared`". So a client holding a bare
 * `host.getRateLimitUsage` response cannot reach `projectProfileUsage` without
 * first writing an envelope builder it has no other use for.
 *
 * ⚠️ **`clients/teams-tab/src/settings/settings-screen.tsx` asserted the
 * opposite** — that the arm normalisation "has ALREADY been generalised into
 * `clients/shared/rate-limits/`", and deferred its usage row until
 * `traycer/mobile-v2-desktop-companion` merged. The premise was checkable and
 * false in the half that mattered: what moved to shared was gui-app's
 * envelope/picker projection, not mobile's `extractUsageWindows`, and merging
 * that branch therefore would not have handed the tab the function its screen
 * needed. Corrected at both sites rather than only here.
 *
 * ## Scope, carried verbatim from mobile
 *
 * Each arm names its windows differently — codex's
 * `primary`/`secondary`/`extraWindows`, claude-code's
 * `fiveHour`/`sevenDay`/`sevenDayOpus`/`sevenDaySonnet`/`modelScoped`, grok's
 * single `period`. openrouter and kilocode report credit balance and spend
 * instead, with no window concept at all, so they return `null` and callers
 * render a balance-only fallback rather than a fabricated percentage.
 *
 * Moved here from `clients/mobile/src/host/use-provider-usage.ts` under the tab
 * plan's decision 6 ("extract on demand, never duplicate"); mobile re-exports
 * from its original path, so its call sites are untouched.
 *
 * Allowed dependencies: `@traycer/protocol` types only.
 */
import type {
  ProviderRateLimits,
  ProviderRateLimitWindow,
} from "@traycer/protocol/host/rate-limit";

export interface UsageWindowRow {
  readonly label: string;
  readonly window: ProviderRateLimitWindow;
}

/**
 * `durationMinutes` → the Planner's exact desktop copy; anything else falls
 * back to a generic label.
 *
 * The two magic numbers are the two windows desktop names in words: 300
 * minutes is the five-hour session, 10080 is a seven-day week. A provider
 * reporting any other duration gets "Usage window" rather than a computed
 * phrase, because a wrong-but-confident label ("Weekly" on a 3-day window) is
 * worse than a generic true one.
 */
export function windowLabel(durationMinutes: number | null): string {
  if (durationMinutes === 300) return "Current session";
  if (durationMinutes === 10080) return "Weekly";
  return "Usage window";
}

/**
 * `null` when the provider's arm has no window/percent concept at all
 * (openrouter/kilocode) — callers show the balance-only fallback instead.
 *
 * Distinct from `[]`, which means "this arm HAS windows and none are currently
 * reported". The two render differently on every caller, so collapsing them
 * would tell an openrouter user their windows had emptied rather than that they
 * never had any.
 */
export function extractUsageWindows(
  rateLimits: ProviderRateLimits,
): readonly UsageWindowRow[] | null {
  if (!rateLimits.available) return null;
  switch (rateLimits.provider) {
    case "codex": {
      const rows: UsageWindowRow[] = [];
      if (rateLimits.primary !== null) {
        rows.push({
          label: windowLabel(rateLimits.primary.durationMinutes),
          window: rateLimits.primary,
        });
      }
      if (rateLimits.secondary !== null) {
        rows.push({
          label: windowLabel(rateLimits.secondary.durationMinutes),
          window: rateLimits.secondary,
        });
      }
      for (const extra of rateLimits.extraWindows) {
        if (extra.primary !== null) {
          rows.push({
            label: extra.limitName ?? windowLabel(extra.primary.durationMinutes),
            window: extra.primary,
          });
        }
      }
      return rows;
    }
    case "claude-code": {
      const rows: UsageWindowRow[] = [];
      if (rateLimits.fiveHour !== null) {
        rows.push({
          label: windowLabel(rateLimits.fiveHour.durationMinutes),
          window: rateLimits.fiveHour,
        });
      }
      if (rateLimits.sevenDay !== null) {
        rows.push({
          label: windowLabel(rateLimits.sevenDay.durationMinutes),
          window: rateLimits.sevenDay,
        });
      }
      if (rateLimits.sevenDayOpus !== null) {
        rows.push({ label: "Opus (weekly)", window: rateLimits.sevenDayOpus });
      }
      if (rateLimits.sevenDaySonnet !== null) {
        rows.push({
          label: "Sonnet (weekly)",
          window: rateLimits.sevenDaySonnet,
        });
      }
      for (const model of rateLimits.modelScoped) {
        rows.push({ label: model.displayName, window: model });
      }
      return rows;
    }
    case "grok":
      return rateLimits.period !== null
        ? [
            {
              label: windowLabel(rateLimits.period.durationMinutes),
              window: rateLimits.period,
            },
          ]
        : [];
    case "openrouter":
    case "kilocode":
      return null;
    default:
      // Defensive: a future rate-limit-capable provider arm this switch
      // doesn't know about yet degrades to "no window data" rather than
      // crashing the usage surface.
      return null;
  }
}

/**
 * Human phrasing for a window's reset instant, coarsening as it recedes:
 * minutes under 3 hours, hours under 2 days, then a weekday date.
 *
 * `now` is a REQUIRED parameter, not a defaulted one. Two reasons and the
 * second is the load-bearing one: `clients/shared` bans default parameter
 * values outright ("require callers to pass every argument explicitly"), and
 * every boundary in this function is a threshold, so a caller that silently
 * inherited a clock would be untestable at exactly the points where its defects
 * live. Callers pass `Date.now()` and it is visible that they did.
 *
 * Returns `""` for a `null` reset, matching the caller's "append only when
 * there is something to append" shape.
 */
export function formatResetLine(resetsAt: number | null, now: number): string {
  if (resetsAt === null) return "";
  const diffMs = resetsAt - now;
  if (diffMs <= 0) return "Resets soon";
  const diffMinutes = Math.round(diffMs / 60_000);
  if (diffMinutes < 180) return `Resets in ${diffMinutes}m`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 48) return `Resets in ${diffHours}h`;
  return `Resets ${new Date(resetsAt).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  })}`;
}
