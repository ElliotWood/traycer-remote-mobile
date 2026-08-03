/**
 * The usage chip's quick-view sheet: per-enabled-provider session/weekly
 * (or provider-native) usage bars. See `use-provider-usage.ts`'s docblock
 * for the scoping simplification (openrouter/kilocode have no window
 * concept — balance-only fallback).
 */
import type { ReactElement } from "react";
import type { ProviderCliState, ProviderProfile } from "@traycer/protocol/host/provider-schemas";
import { useHostClientOrNull, type MobileHostClient } from "@/host/host-client-context";
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

/**
 * M2 item 1 — one usage block PER PROFILE, not one for a guessed "active" one.
 *
 * This card used to do `provider.profiles[0] ?? null` and read usage for that
 * profile alone. With more than one profile configured it reported another
 * account's limits under this provider's name, confidently and with no way to
 * tell.
 *
 * The instinctive fix — "determine the genuinely active profile" — is not
 * available: `providerProfileSchema` carries no `isActive` / `lastUsed` /
 * equivalent, and the provider row's only active-ish field is `selected`,
 * which names the CLI binary (`{kind: "bundled"}`), not a profile. Verified on
 * a live host as well as in the schema. Desktop's own resolver falls back to
 * index 0 for exactly this reason, and it only works there because it has two
 * inputs this sheet does not: a browsed selection and a chat's committed
 * `selectedProfileId`.
 *
 * This sheet is provider-global — it has no chat, so "the active profile" is
 * not merely unknown here, it is UNDEFINED. So it stops choosing. Every
 * profile gets a row, each labelled, and the wrong-account bug is deleted
 * rather than relocated.
 */
function ProviderUsageCard({
  client,
  provider,
}: {
  readonly client: MobileHostClient | null;
  readonly provider: ProviderCliState;
}): ReactElement {
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

      {provider.profiles.length === 0 ? (
        <ProfileUsageBlock client={client} provider={provider} profile={null} showLabel={false} />
      ) : (
        provider.profiles.map((profile) => (
          <ProfileUsageBlock
            key={profile.profileId}
            client={client}
            provider={provider}
            profile={profile}
            // Only label rows when there is something to distinguish. A lone
            // profile needs no name; two or more always do.
            showLabel={provider.profiles.length > 1}
          />
        ))
      )}
    </div>
  );
}

/**
 * One profile's usage. Its own component because `useRateLimitUsage` is a
 * hook — the per-profile fetch cannot be looped inside the card.
 */
function ProfileUsageBlock({
  client,
  provider,
  profile,
  showLabel,
}: {
  readonly client: MobileHostClient | null;
  readonly provider: ProviderCliState;
  /** `null` when the provider reports no profiles at all — the pre-profile shape. */
  readonly profile: ProviderProfile | null;
  readonly showLabel: boolean;
}): ReactElement {
  const { rateLimits, loading } = useRateLimitUsage(
    client,
    provider.providerId,
    profile?.profileId ?? null,
  );
  const windows = rateLimits !== null ? extractUsageWindows(rateLimits) : null;

  return (
    <div style={{ marginTop: showLabel ? 8 : 0 }}>
      {showLabel && profile !== null && (
        <div style={{ ...type.bodyXs, color: theme.mutedText, marginBottom: 4 }}>
          {profile.label}
          {profile.kind === "ambient" && " · signed in on this machine"}
        </div>
      )}
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
