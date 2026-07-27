/**
 * Provider accounts + rate-limit usage — `providers.list` (poll, plain
 * unary) + `host.getRateLimitUsage` per provider (poll). Scoped down from
 * desktop's full multi-window/per-model/credit-detail rendering: this
 * normalizes each provider arm's own field names (codex's
 * primary/secondary/extraWindows, claude-code's fiveHour/sevenDay/
 * sevenDayOpus/sevenDaySonnet/modelScoped, grok's single `period`) into a
 * common `{label, window}[]` list wherever the arm actually carries
 * percent/reset window data — openrouter and kilocode report
 * credit-balance/spend fields instead (no window concept at all), so those
 * degrade to a plain balance line rather than a fabricated percent bar.
 */
import { useEffect, useState } from "react";
import type { ProviderCliState, ProviderId } from "@traycer/protocol/host/provider-schemas";
import type {
  ProviderRateLimitWindow,
  ProviderRateLimits,
} from "@traycer/protocol/host/rate-limit/schemas";
import { DEFAULT_ACCOUNT_CONTEXT } from "@traycer/protocol/common/schemas";
import type { MobileHostClient } from "./host-client-context";

export interface UsageWindowRow {
  readonly label: string;
  readonly window: ProviderRateLimitWindow;
}

/** `durationMinutes` → the Planner's exact desktop copy ("Current session"/"Weekly"); anything else falls back to a generic label. */
export function windowLabel(durationMinutes: number | null): string {
  if (durationMinutes === 300) return "Current session";
  if (durationMinutes === 10080) return "Weekly";
  return "Usage window";
}

/** `null` when the provider's arm has no window/percent concept at all (openrouter/kilocode) — callers show the balance-only fallback instead. */
export function extractUsageWindows(rateLimits: ProviderRateLimits): readonly UsageWindowRow[] | null {
  if (!rateLimits.available) return null;
  switch (rateLimits.provider) {
    case "codex": {
      const rows: UsageWindowRow[] = [];
      if (rateLimits.primary !== null) rows.push({ label: windowLabel(rateLimits.primary.durationMinutes), window: rateLimits.primary });
      if (rateLimits.secondary !== null) rows.push({ label: windowLabel(rateLimits.secondary.durationMinutes), window: rateLimits.secondary });
      for (const extra of rateLimits.extraWindows) {
        if (extra.primary !== null) rows.push({ label: extra.limitName ?? windowLabel(extra.primary.durationMinutes), window: extra.primary });
      }
      return rows;
    }
    case "claude-code": {
      const rows: UsageWindowRow[] = [];
      if (rateLimits.fiveHour !== null) rows.push({ label: windowLabel(rateLimits.fiveHour.durationMinutes), window: rateLimits.fiveHour });
      if (rateLimits.sevenDay !== null) rows.push({ label: windowLabel(rateLimits.sevenDay.durationMinutes), window: rateLimits.sevenDay });
      if (rateLimits.sevenDayOpus !== null) rows.push({ label: "Opus (weekly)", window: rateLimits.sevenDayOpus });
      if (rateLimits.sevenDaySonnet !== null) rows.push({ label: "Sonnet (weekly)", window: rateLimits.sevenDaySonnet });
      for (const model of rateLimits.modelScoped) {
        rows.push({ label: model.displayName, window: model });
      }
      return rows;
    }
    case "grok":
      return rateLimits.period !== null
        ? [{ label: windowLabel(rateLimits.period.durationMinutes), window: rateLimits.period }]
        : [];
    case "openrouter":
    case "kilocode":
      return null;
    default:
      // Defensive: a future rate-limit-capable provider arm this switch
      // doesn't know about yet degrades to "no window data" rather than
      // crashing the usage sheet.
      return null;
  }
}

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
