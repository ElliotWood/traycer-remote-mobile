/**
 * The usage chip's quick-view sheet: per-enabled-provider session/weekly
 * (or provider-native) usage bars. See `use-provider-usage.ts`'s docblock
 * for the scoping simplification (openrouter/kilocode have no window
 * concept — balance-only fallback).
 */
import type { ReactElement } from "react";
import type { ProviderCliState } from "@traycer/protocol/host/provider-schemas";
import { useHostClientOrNull } from "@/host/host-client-context";
import { useProviders, useRateLimitUsage, extractUsageWindows, type UsageWindowRow } from "@/host/use-provider-usage";
import { PROVIDER_DISPLAY_NAMES } from "@traycer/protocol/host/provider-schemas";
import { radius, theme, type } from "@/views/design-tokens";
import { BottomSheet } from "./bottom-sheet";

export interface UsageSheetProps {
  readonly onClose: () => void;
}

export function UsageSheet({ onClose }: UsageSheetProps): ReactElement {
  const client = useHostClientOrNull();
  const { providers, loading } = useProviders(client);
  const enabled = providers.filter((p) => p.enabled);

  return (
    <BottomSheet title="Usage" onClose={onClose}>
      {loading ? (
        <p style={{ ...type.bodySm, color: theme.mutedText }}>Loading…</p>
      ) : enabled.length === 0 ? (
        <p style={{ ...type.bodySm, color: theme.mutedText }}>No providers enabled.</p>
      ) : (
        enabled.map((provider) => (
          <ProviderUsageCard key={provider.providerId} client={client} provider={provider} />
        ))
      )}
    </BottomSheet>
  );
}

function ProviderUsageCard({
  client,
  provider,
}: {
  readonly client: ReturnType<typeof useHostClientOrNull>;
  readonly provider: ProviderCliState;
}): ReactElement {
  const activeProfile = provider.profiles[0] ?? null;
  const { rateLimits, loading } = useRateLimitUsage(client, provider.providerId, activeProfile?.profileId ?? null);
  const windows = rateLimits !== null ? extractUsageWindows(rateLimits) : null;

  return (
    <div
      style={{
        borderRadius: radius.lg,
        borderWidth: 1,
        borderStyle: "solid",
        borderColor: theme.borderHairline,
        padding: 12,
        marginBottom: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "50%", background: theme.primary, flexShrink: 0 }} />
        <span style={{ ...type.bodySm, fontWeight: 600, color: theme.text }}>
          {PROVIDER_DISPLAY_NAMES[provider.providerId] ?? provider.providerId}
        </span>
        {provider.auth.label !== null && (
          <span style={{ ...type.bodyXs, color: theme.mutedText }}>· {provider.auth.label}</span>
        )}
        {provider.auth.badgeText !== null && (
          <span
            style={{
              ...type.bodyXs,
              marginLeft: "auto",
              padding: "1px 8px",
              borderRadius: 999,
              background: "color-mix(in oklch, var(--primary) 14%, transparent)",
              color: theme.primary,
            }}
          >
            {provider.auth.badgeText}
          </span>
        )}
      </div>

      {loading ? (
        <p style={{ ...type.bodyXs, color: theme.mutedText, margin: 0 }}>Loading usage…</p>
      ) : rateLimits === null ? (
        <p style={{ ...type.bodyXs, color: theme.mutedText, margin: 0 }}>Usage unavailable.</p>
      ) : !rateLimits.available ? (
        <p style={{ ...type.bodyXs, color: theme.mutedText, margin: 0 }}>{rateLimits.reason.replace(/_/g, " ")}</p>
      ) : windows === null ? (
        <p style={{ ...type.bodyXs, color: theme.mutedText, margin: 0 }}>
          No usage-window data for this provider.
        </p>
      ) : windows.length === 0 ? (
        <p style={{ ...type.bodyXs, color: theme.mutedText, margin: 0 }}>No active usage windows.</p>
      ) : (
        windows.map((row, i) => <UsageWindowMeter key={i} row={row} />)
      )}
    </div>
  );
}

function formatResetLine(resetsAt: number | null): string {
  if (resetsAt === null) return "";
  const diffMs = resetsAt - Date.now();
  if (diffMs <= 0) return "Resets soon";
  const diffMinutes = Math.round(diffMs / 60_000);
  if (diffMinutes < 180) return `Resets in ${diffMinutes}m`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 48) return `Resets in ${diffHours}h`;
  return `Resets ${new Date(resetsAt).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}`;
}

function UsageWindowMeter({ row }: { readonly row: UsageWindowRow }): ReactElement {
  const percent = Math.max(0, Math.min(100, Math.round(row.window.usedPercent)));
  const severe = percent >= 90;
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", ...type.bodyXs, color: theme.mutedText, marginBottom: 3 }}>
        <span>{row.label}</span>
        <span>
          {percent}% used{row.window.resetsAt !== null ? ` · ${formatResetLine(row.window.resetsAt)}` : ""}
        </span>
      </div>
      <div style={{ height: 6, borderRadius: 999, background: theme.border, overflow: "hidden" }}>
        <div
          style={{
            height: "100%",
            width: `${percent}%`,
            background: severe ? theme.danger : theme.primary,
            borderRadius: 999,
          }}
        />
      </div>
    </div>
  );
}
