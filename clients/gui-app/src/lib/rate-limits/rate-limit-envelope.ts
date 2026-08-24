import type { QueryClient, QueryKey } from "@tanstack/react-query";
// `ProviderRateLimits` / `RateLimitUnavailableReason` are no longer imported
// here: the declarations that used them went to `clients/shared` with the pure
// half. eslint caught them as unused — the split's own leftovers.
import type { ResponseOfMethod } from "@traycer-clients/shared/host-transport/host-messenger";
import type { HostRpcRegistry } from "@/lib/host";
/**
 * SPLIT (M2 item 5): the pure half of this module moved to
 * `clients/shared/rate-limits/provider-rate-limit-envelope.ts` so the mobile
 * composer applies the same retention rules. What remains here is the
 * TanStack query-cache convergence, which is genuinely gui-app's:
 * `@tanstack/react-query` deliberately did NOT follow the pure half into
 * `clients/shared`.
 *
 * Re-exported so every existing consumer of this path is unaffected.
 */
import {
  isTransientUnavailableReason,
  type AvailableProviderRateLimits,
  type ProviderRateLimitEnvelope,
} from "@traycer-clients/shared/rate-limits/provider-rate-limit-envelope";

export * from "@traycer-clients/shared/rate-limits/provider-rate-limit-envelope";

const PROVIDERS_LIST_METHOD_DISCRIMINATOR = "providers.list";

/** The raw wire response for `host.getRateLimitUsage` at whatever version the GUI currently negotiates. */
export type RateLimitUsageResponse = ResponseOfMethod<
  HostRpcRegistry,
  "host.getRateLimitUsage"
>;

/**
 * Some Codex refreshes report the authoritative reset-credit count without
 * repeating the optional per-credit detail list. Keep the last detailed list
 * only while that count is unchanged: `credits: null` means "details omitted",
 * whereas `credits: []` is an explicit detailed response. A changed count can
 * mean a reset was granted, consumed, or expired, so retaining the old list in
 * that case would be actively misleading.
 */
function retainCodexResetCreditDetails(
  previous: ProviderRateLimitEnvelope | undefined,
  latest: AvailableProviderRateLimits,
): AvailableProviderRateLimits {
  if (latest.provider !== "codex") return latest;
  const latestResetCredits = latest.resetCredits;
  if (latestResetCredits === null || latestResetCredits.credits !== null) {
    return latest;
  }

  const previousCodex = previous?.lastGood;
  if (previousCodex === undefined || previousCodex === null) return latest;
  if (previousCodex.provider !== "codex") return latest;
  const previousResetCredits = previousCodex.resetCredits;
  if (
    previousResetCredits === null ||
    previousResetCredits.credits === null ||
    previousResetCredits.availableCount !== latestResetCredits.availableCount
  ) {
    return latest;
  }

  return {
    ...latest,
    resetCredits: {
      ...latestResetCredits,
      credits: previousResetCredits.credits,
    },
  };
}

/**
 * Renderer-memory envelope the `host.getRateLimitUsage` provider-pull query
 * cache entry holds (replacing the raw wire response as the cached `data`),
 * so a transient fetch failure (Core Flows: "couldn't fetch usage - will
 * retry") doesn't blank a real, recent reading the way replacing `data`
 * outright would.
 *
 * - `latest`: the most recent provider snapshot exactly as the wire reported
 *   it (its own `available` arm decides what the CURRENT attempt says).
 * - `lastGood`: the most recent `available: true` snapshot, retained across a
 *   transient failure. `null` once an authoritative unavailable reason
 *   arrives (that reason replaces the picture entirely - see
 *   `buildProviderRateLimitEnvelope`) or before any successful read has ever
 *   happened (cold start / after a reload - this is renderer-memory only).
 * - `lastGoodAt` / `lastFailureAt`: epoch-ms timestamps for the two events
 *   above, `null` until they've happened at least once in this envelope's
 *   lifetime.
 */

/**
 * Whether `response` carries a snapshot for a provider whose `providers.list`
 * profile rows report cached `rateLimitStatus`: claude-code, codex, or grok.
 * Openrouter/kilocode/traycer-aperture reads gate out here so a convergence
 * invalidation isn't spent on a provider that could never affect the
 * switch-prompt banner. Failed probes (`available: false` - timeout,
 * cli_not_found, ...) gate out too: they carry no usage the host's gauge cache
 * could have captured, so `providers.list` has nothing new to converge on.
 */
function isManagedProfileCapableRateLimitsResponse(
  response: RateLimitUsageResponse,
): boolean {
  const provider = response.providerRateLimits;
  return (
    provider !== null &&
    provider.available &&
    (provider.provider === "codex" ||
      provider.provider === "claude-code" ||
      provider.provider === "grok")
  );
}

/**
 * Converges the composer's rate-limit switch-prompt banner (which reads
 * `providers.list`) with whatever this `host.getRateLimitUsage` fetch just
 * learned: a profile the popover/queue just observed crossing into (or out
 * of) near/hard limit should not wait for `providers.list`'s own unrelated
 * refetch cadence to reflect that.
 *
 * Invalidated by a broad key-prefix predicate rather than one exact `hostId`:
 * this fetch's own host (the default host, or whichever host the ephemeral
 * queue is bound to) is not necessarily the tab host the banner's
 * `providers.list` query is scoped to, and `providers.list` is a cheap
 * cache-only host read (no subprocess, no account probe), so invalidating it
 * across every currently-cached host scope is safe.
 */
function invalidateProvidersListForConvergence(
  queryClient: QueryClient,
  response: RateLimitUsageResponse,
): void {
  if (!isManagedProfileCapableRateLimitsResponse(response)) return;
  void queryClient.invalidateQueries({
    predicate: (query) =>
      query.queryKey.includes(PROVIDERS_LIST_METHOD_DISCRIMINATOR),
  });
}

/**
 * Pure accumulator: folds a fresh wire response into the envelope built from
 * `previous` (the envelope this same query key held before this fetch, or
 * `undefined` on a cold cache - the first fetch ever, or after a reload, since
 * this envelope is renderer-memory only).
 *
 * - `available: true` -> becomes the new `lastGood` outright.
 * - `available: false` with a transient reason -> `latest` reflects the
 *   failure, but `lastGood`/`lastGoodAt` carry over unchanged from `previous`
 *   (retention). `lastFailureAt` advances to `now`.
 * - `available: false` with an authoritative reason (`rate_limits_not_available`
 *   and friends), or no provider snapshot at all (`providerRateLimits: null` -
 *   an aperture-only call; never expected for the provider-pull branch this
 *   envelope serves, but handled the same way defensively) -> replaces the
 *   picture entirely: `lastGood`/`lastGoodAt`/`lastFailureAt` all reset to
 *   `null`. An authoritative "this account can't see usage" reading must
 *   never be shown dimmed alongside a stale good one.
 */
export function buildProviderRateLimitEnvelope(
  previous: ProviderRateLimitEnvelope | undefined,
  response: RateLimitUsageResponse,
  now: number,
): ProviderRateLimitEnvelope {
  const latest = response.providerRateLimits;

  if (latest !== null && latest.available) {
    const retainedLatest = retainCodexResetCreditDetails(previous, latest);
    return {
      latest: retainedLatest,
      lastGood: retainedLatest,
      lastGoodAt: now,
      lastFailureAt: previous?.lastFailureAt ?? null,
    };
  }

  if (latest !== null && isTransientUnavailableReason(latest.reason)) {
    return {
      latest,
      lastGood: previous?.lastGood ?? null,
      lastGoodAt: previous?.lastGoodAt ?? null,
      lastFailureAt: now,
    };
  }

  return { latest, lastGood: null, lastGoodAt: null, lastFailureAt: null };
}

/**
 * The shared fetch wrapper both `host.getRateLimitUsage` provider-pull write
 * lanes fold their fresh response through before handing it to TanStack as
 * the cached `data`: the `ephemeralProcess` serial queue
 * (`ephemeral-fetch-queue.ts`, which fetches via its own `queryClient.fetchQuery`
 * call) and the `httpFetch` lane (`use-host-provider-rate-limits-query.ts` /
 * `use-header-rate-limit-bars.ts` / the popover's "Refresh all" button, all via
 * `useHostQueryWithResponseMap` / `useHostQueriesWithResponseMap`). Both write
 * into the same query-key family, so routing every write through this one
 * function is what keeps the envelope shape consistent no matter which lane's
 * fetch actually lands - see those hooks' own doc comments for why a bespoke
 * wrapper was necessary instead of the plain `useHostQuery` path.
 *
 * Reads `previous` from the exact cache slot the caller is about to write
 * (`queryClient.getQueryData(queryKey)`) - synchronous, and always up to date
 * for this purpose because it runs inside the same queryFn invocation that
 * will overwrite that slot.
 *
 * Also the single point where a resolved codex/claude-code/grok fetch converges
 * `providers.list` (`invalidateProvidersListForConvergence`) - every real
 * `host.getRateLimitUsage` fetch for those two providers folds through this
 * function (the ephemeral queue's own `queryFn`; every other observer of
 * these providers' query key stays `enabled: false`), so this is exactly
 * "whenever a rate-limit usage fetch resolves" without duplicating the
 * invalidation at each call site.
 */
export function mapResponseToProviderRateLimitEnvelope(args: {
  readonly response: RateLimitUsageResponse;
  readonly queryClient: QueryClient;
  readonly queryKey: QueryKey;
}): ProviderRateLimitEnvelope {
  const previous = args.queryClient.getQueryData<ProviderRateLimitEnvelope>(
    args.queryKey,
  );
  invalidateProvidersListForConvergence(args.queryClient, args.response);
  return buildProviderRateLimitEnvelope(previous, args.response, Date.now());
}
