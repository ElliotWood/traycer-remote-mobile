/**
 * M2 item 3 — the rate-limit banner above the composer.
 *
 * On a phone, a rate-limited profile currently manifests as an agent that
 * simply stops, with nothing on screen saying why or offering another account.
 * This is the surface that says why.
 *
 * All of the judgement lives in `rate-limit-banner-model.ts`; this renders it.
 * In particular this component does **no** ranking of its own — see that
 * module for why the destination-side and warning-side reads are not
 * interchangeable.
 *
 * ## Switching is user-confirmed only
 *
 * The banner offers a target and the user taps it. Desktop's equivalent is
 * explicitly user-confirmed-only, and a phone in a pocket is the worst place
 * to silently start spending a different account.
 */
import { useState, type ReactElement } from "react";
import { AlertTriangle, X } from "lucide-react";
import type { GuiAgentModelOption } from "@traycer/protocol/host/agent/gui/unary-schemas";
import type { ProviderProfile } from "@traycer/protocol/host/provider-schemas";
import { deriveRateLimitBanner } from "@/views/chat/rate-limit-banner-model";
import { UsageSheet } from "@/views/toolbar/usage-sheet";
import { radius, theme, type } from "@/views/design-tokens";

/**
 * Copy for the limited scope.
 *
 * An EMPTY family list is profile-wide and gets generic copy — it never tries
 * to name a family, because there isn't one. That is the case the ticket got
 * backwards, and it is also the shape the live host actually sends
 * (`[{family: null, …}]`).
 */
function limitDescription(
  severity: "near_limit" | "hard_limit",
  families: readonly string[],
): string {
  const verb = severity === "hard_limit" ? "has reached its rate limit" : "is close to its rate limit";
  if (families.length === 0) return verb;
  return `${verb} for ${families.join(", ")}`;
}

export function RateLimitBanner({
  profiles,
  currentProfileId,
  model,
  onSwitchProfile,
}: {
  readonly profiles: readonly ProviderProfile[];
  readonly currentProfileId: string | null;
  readonly model: GuiAgentModelOption | null;
  readonly onSwitchProfile: (profileId: string | null) => void;
}): ReactElement | null {
  const [dismissedEpisode, setDismissedEpisode] = useState<string | null>(null);
  const [limitsOpen, setLimitsOpen] = useState(false);
  const banner = deriveRateLimitBanner({ profiles, currentProfileId, model });

  if (banner === null) return null;
  // Dismissal is per EPISODE, not global: escalating from near_limit to
  // hard_limit produces a new key, so silencing the softer warning does not
  // silence the one that actually stops work.
  if (banner.episodeKey === dismissedEpisode) return null;

  const severe = banner.severity === "hard_limit";

  return (
    <div
      role="status"
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        padding: "8px 10px",
        marginBottom: 8,
        borderRadius: radius.md,
        border: `1px solid ${severe ? theme.danger : theme.border}`,
        background: "transparent",
      }}
    >
      <AlertTriangle
        size={14}
        aria-hidden="true"
        style={{ color: severe ? theme.danger : theme.mutedText, flexShrink: 0, marginTop: 2 }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ ...type.bodyXs, color: theme.text, margin: 0 }}>
          {banner.currentLabel} {limitDescription(banner.severity, banner.limitedFamilies)}.
        </p>
        {banner.switchTarget === null ? (
          // The terminal state, and it must not offer an action it cannot
          // honour. Live specimen: a provider with exactly one profile, hard
          // limited.
          <p style={{ ...type.bodyXs, color: theme.mutedText, margin: "2px 0 0" }}>
            No other profile is currently available.
          </p>
        ) : (
          <button
            type="button"
            onClick={() => {
              onSwitchProfile(banner.switchTarget?.profileId ?? null);
            }}
            style={{
              ...type.bodyXs,
              marginTop: 4,
              padding: 0,
              border: "none",
              background: "transparent",
              color: theme.primary,
              cursor: "pointer",
            }}
          >
            Switch to {banner.switchTarget.label}
          </button>
        )}
        {/* M2 item 4 — REUSE the usage sheet rather than rebuilding a
            limits view, anchored to the profile this banner is about. */}
        <button
          type="button"
          onClick={() => setLimitsOpen(true)}
          style={{
            ...type.bodyXs,
            display: "block",
            marginTop: 4,
            padding: 0,
            border: "none",
            background: "transparent",
            color: theme.mutedText,
            cursor: "pointer",
          }}
        >
          View profile limits
        </button>
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => setDismissedEpisode(banner.episodeKey)}
        style={{
          border: "none",
          background: "transparent",
          color: theme.mutedText,
          cursor: "pointer",
          padding: 0,
          flexShrink: 0,
        }}
      >
        <X size={13} aria-hidden="true" />
      </button>
      {limitsOpen && (
        <UsageSheet onClose={() => setLimitsOpen(false)} anchorProfileId={currentProfileId} />
      )}
    </div>
  );
}
