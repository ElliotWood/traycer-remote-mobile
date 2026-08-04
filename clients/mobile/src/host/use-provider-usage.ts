/**
 * Provider accounts + rate-limit usage — `providers.list` (poll, plain
 * unary) + `host.getRateLimitUsage` per provider (poll).
 *
 * THE ARM NORMALISATION MOVED. `windowLabel`, `extractUsageWindows` and
 * `UsageWindowRow` now live in
 * `@traycer-clients/shared/rate-limits/usage-windows` and are re-exported
 * below, under the tab plan's decision 6 ("extract on demand, never
 * duplicate") — `clients/teams-tab`'s settings screen needs the same
 * normalisation and had deferred its usage row for want of it. The re-export
 * is why every call site in this package is unchanged.
 *
 * What stays here is what is genuinely mobile's: the two polling hooks, typed
 * on `MobileHostClient`.
 */
import { useEffect, useState } from "react";
import type { ProviderCliState, ProviderId } from "@traycer/protocol/host/provider-schemas";
import type { ProviderRateLimits } from "@traycer/protocol/host/rate-limit/schemas";
import { DEFAULT_ACCOUNT_CONTEXT } from "@traycer/protocol/common/schemas";
import type { MobileHostClient } from "./host-client-context";

export {
  extractUsageWindows,
  formatResetLine,
  windowLabel,
  type UsageWindowRow,
} from "@traycer-clients/shared/rate-limits/usage-windows";

export interface UseProvidersResult {
  readonly providers: readonly ProviderCliState[];
  readonly loading: boolean;
}

const PROVIDERS_POLL_MS = 60_000;

export function useProviders(client: MobileHostClient | null): UseProvidersResult {
  const [providers, setProviders] = useState<readonly ProviderCliState[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (client === null) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    const fetchOnce = async (): Promise<void> => {
      try {
        const response = await client.request("providers.list", {});
        if (!cancelled) {
          setProviders(response.providers);
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    };
    void fetchOnce();
    const interval = setInterval(() => void fetchOnce(), PROVIDERS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [client]);

  return { providers, loading };
}

export interface UseRateLimitUsageResult {
  readonly rateLimits: ProviderRateLimits | null;
  readonly loading: boolean;
}

export function useRateLimitUsage(
  client: MobileHostClient | null,
  providerId: ProviderId | null,
  profileId: string | null,
): UseRateLimitUsageResult {
  const [rateLimits, setRateLimits] = useState<ProviderRateLimits | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (client === null || providerId === null) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const fetchOnce = async (): Promise<void> => {
      try {
        const response = await client.request("host.getRateLimitUsage", {
          accountContext: DEFAULT_ACCOUNT_CONTEXT,
          providerId,
          profileId,
        });
        if (!cancelled) {
          setRateLimits(response.providerRateLimits ?? null);
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    };
    void fetchOnce();
    const interval = setInterval(() => void fetchOnce(), PROVIDERS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [client, providerId, profileId]);

  return { rateLimits, loading };
}
