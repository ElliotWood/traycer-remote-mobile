/**
 * The PURE half of gui-app's `lib/rate-limits/rate-limit-envelope.ts`: the
 * retained-reading envelope and the two resolvers over it.
 *
 * ## Why this is a split rather than a move (M2 item 5)
 *
 * That file has two halves with different dependencies. This one is pure
 * functions over protocol types. The other converges a TanStack query cache
 * and imports `@tanstack/react-query` plus gui-app's own `HostRpcRegistry` —
 * `RateLimitUsageResponse`, `buildProviderRateLimitEnvelope`,
 * `mapResponseToProviderRateLimitEnvelope` and the invalidation logic. **That
 * half stays in gui-app**, and react-query deliberately does NOT follow this
 * one into `clients/shared`: nothing here needs it, and adding a UI-framework
 * data-layer dependency to a package the mobile bundle imports would be the
 * wrong direction.
 *
 * Verified by reading each declaration rather than by proximity — an early
 * `grep -A 14` window bled across a function boundary and made this interface
 * look like it touched `QueryClient`. A context window is a line count, not a
 * scope.
 *
 * gui-app re-exports every symbol below from its original path, so its twelve
 * consumers and their tests are untouched.
 *
 * Allowed dependencies: `@traycer/protocol` types only.
 */
import type {
  ProviderRateLimits,
  RateLimitUnavailableReason,
} from "@traycer/protocol/host";

/** The `available: true` arm of `ProviderRateLimits` - the only shape worth retaining. */
export type AvailableProviderRateLimits = Extract<
  ProviderRateLimits,
  { available: true }
>;

/**
 * Reasons a provider-pull can fail that are transient - a fetch problem on
 * THIS attempt, not a statement about the account's capability to ever report
 * usage. `usage_fetch_failed` is the CLI usage-HTTP-fetch failure (e.g. a
 * server-side 429 on Anthropic's `/api/oauth/usage` with a multi-minute
 * penalty window); `timeout`/`connection_failed` are the probe-level
 * analogues. Every other reason (`rate_limits_not_available`, `cli_not_found`,
 * etc.) is authoritative - it says something about the account/setup, not "try
 * again shortly" - so a retained last-good reading must NOT survive alongside
 * one of those.
 */
const TRANSIENT_UNAVAILABLE_REASONS: ReadonlySet<RateLimitUnavailableReason> =
  new Set(["usage_fetch_failed", "timeout", "connection_failed"]);

export function isTransientUnavailableReason(
  reason: RateLimitUnavailableReason,
): boolean {
  return TRANSIENT_UNAVAILABLE_REASONS.has(reason);
}

/**
 * A provider's retained rate-limit picture.
 *
 * - `latest`: the most recent provider snapshot exactly as the wire reported
 *   it (its own `available` arm decides what the CURRENT attempt says).
 * - `lastGood`: the most recent `available: true` snapshot, retained across a
 *   transient failure. `null` once an authoritative unavailable reason arrives
 *   (that reason replaces the picture entirely) or before any successful read
 *   has ever happened (cold start / after a reload - renderer memory only).
 * - `lastGoodAt` / `lastFailureAt`: epoch-ms timestamps for the two events
 *   above, `null` until they've happened at least once in this envelope's
 *   lifetime.
 */
export interface ProviderRateLimitEnvelope {
  readonly latest: ProviderRateLimits | null;
  readonly lastGood: AvailableProviderRateLimits | null;
  readonly lastGoodAt: number | null;
  readonly lastFailureAt: number | null;
}

/**
 * What a consumer should currently render for a provider: the retained
 * `lastGood` reading when the latest attempt is a transient failure with one
 * available, otherwise exactly what the latest attempt reported (a good
 * reading, an authoritative unavailable reason, or `null` if no provider
 * snapshot has ever arrived).
 */
export function resolveRetainedProviderRateLimits(
  envelope: ProviderRateLimitEnvelope | null,
): ProviderRateLimits | null {
  if (envelope === null) return null;
  const { latest, lastGood } = envelope;
  if (latest === null) return null;
  if (latest.available) return latest;
  if (isTransientUnavailableReason(latest.reason) && lastGood !== null) {
    return lastGood;
  }
  return latest;
}

/**
 * Whether the CURRENT retained view (`resolveRetainedProviderRateLimits`) is a
 * dimmed last-known-good reading rather than a fresh one - true only when the
 * latest attempt itself is a transient failure and a `lastGood` reading is
 * being shown in its place. Distinct from a query-level `isError` degrade
 * (TanStack retaining old data across a thrown fetch exception): that case has
 * no specific wire reason to report and stays the caller's own generic
 * "refresh failed" treatment.
 */
export function envelopeDegradedReason(
  envelope: ProviderRateLimitEnvelope | null,
): RateLimitUnavailableReason | null {
  if (envelope === null) return null;
  const { latest, lastGood } = envelope;
  if (latest === null || latest.available) return null;
  if (isTransientUnavailableReason(latest.reason) && lastGood !== null) {
    return latest.reason;
  }
  return null;
}
