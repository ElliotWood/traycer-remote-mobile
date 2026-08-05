/**
 * The App settings screen (avatar → Account sheet → App settings). Scoped
 * down from desktop's full settings surface (General/Appearance/Providers/
 * Notifications/Agent selection/Keybindings/Shell/Worktrees/Host/
 * Diagnostics) to what's both meaningful on a phone and reachable from the
 * mobile HostClient — Providers (incl. usage, doubling as the fuller usage
 * surface), Notifications (renderer severities + the browser permission),
 * About/Diagnostics (host version, connection, sign out). Everything else
 * (appearance/keybindings/shell/worktree config, the email notification
 * channel) is desktop-only or has no phone-appropriate UI — flagged here,
 * not silently missing.
 */
import { useState, type ReactElement } from "react";
import { Check, LogOut, Wifi } from "lucide-react";
import {
  isWakeLockSupported,
  useWakeLockPreference,
  writeWakeLockPreference,
  type WakeLockPreference,
} from "@/host/use-screen-wake-lock";
import { useHostClientOrNull, type MobileHostClient } from "@/host/host-client-context";
import { useProviders, useRateLimitUsage, extractUsageWindows } from "@/host/use-provider-usage";
import { useNotificationConfig } from "@/host/use-notification-config";
import {
  getNotificationPermission,
  requestNotificationPermission,
  isNotificationsSecureContextBlocked,
} from "@/host/notifications";
import { useHostStatus } from "@/host/use-host-status";
import { PROVIDER_DISPLAY_NAMES, type ProviderCliState } from "@traycer/protocol/host/provider-schemas";
import type { HostNotificationSeverity } from "@traycer/protocol/host/notifications/host-notifications";
import { HOST_WS_URL } from "@/config";
import { radius, screen, theme, type } from "@/views/design-tokens";

export interface SettingsScreenProps {
  readonly onSignOut: () => void;
}

const SEVERITY_LABELS: Readonly<Record<HostNotificationSeverity, string>> = {
  info: "Informational",
  needs_action: "Needs your action (approvals/interviews)",
  failure: "Failures",
  done: "Completed",
};

export function SettingsScreen({ onSignOut }: SettingsScreenProps): ReactElement {
  const client = useHostClientOrNull();

  return (
    <main style={screen}>
      <h1 style={{ ...type.titleMd, margin: "0 0 16px", color: theme.text }}>Settings</h1>

      <ProvidersSection client={client} />
      <NotificationsSection client={client} />
      <DisplaySection />
      <AboutSection client={client} onSignOut={onSignOut} />
    </main>
  );
}

function SectionHeading({ children }: { readonly children: string }): ReactElement {
  return (
    <h2
      style={{
        ...type.bodyXs,
        fontWeight: 700,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        color: theme.mutedText,
        margin: "0 0 8px",
      }}
    >
      {children}
    </h2>
  );
}

function ProvidersSection({ client }: { readonly client: MobileHostClient | null }): ReactElement {
  const { providers, loading } = useProviders(client);

  return (
    <section style={{ marginBottom: 24 }}>
      <SectionHeading>Providers</SectionHeading>
      {loading ? (
        <p style={{ ...type.bodySm, color: theme.mutedText }}>Loading…</p>
      ) : providers.length === 0 ? (
        <p style={{ ...type.bodySm, color: theme.mutedText }}>No providers reported by this host.</p>
      ) : (
        providers.map((provider) => <ProviderRow key={provider.providerId} client={client} provider={provider} />)
      )}
    </section>
  );
}

function ProviderRow({
  client,
  provider,
}: {
  readonly client: MobileHostClient | null;
  readonly provider: ProviderCliState;
}): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const activeProfile = provider.profiles[0] ?? null;
  const { rateLimits } = useRateLimitUsage(
    client,
    expanded ? provider.providerId : null,
    activeProfile?.profileId ?? null,
  );
  const windows = rateLimits !== null ? extractUsageWindows(rateLimits) : null;

  return (
    <div
      style={{
        borderRadius: radius.lg,
        borderWidth: 1,
        borderStyle: "solid",
        borderColor: theme.borderHairline,
        marginBottom: 8,
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          minHeight: 44,
          padding: "0 12px",
          border: "none",
          background: "transparent",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: provider.enabled ? theme.primary : theme.mutedText,
            flexShrink: 0,
          }}
        />
        <span style={{ ...type.bodySm, color: theme.text, flex: 1 }}>
          {PROVIDER_DISPLAY_NAMES[provider.providerId] ?? provider.providerId}
        </span>
        <span style={{ ...type.bodyXs, color: theme.mutedText }}>
          {provider.auth.status === "authenticated" ? "Connected" : provider.auth.status}
        </span>
      </button>
      {expanded && (
        <div style={{ padding: "0 12px 12px", borderTop: `1px solid ${theme.borderHairline}` }}>
          {activeProfile !== null && (
            <p style={{ ...type.bodyXs, color: theme.mutedText, margin: "10px 0" }}>{activeProfile.label}</p>
          )}
          {windows === null ? (
            <p style={{ ...type.bodyXs, color: theme.mutedText, margin: 0 }}>No usage-window data.</p>
          ) : windows.length === 0 ? (
            <p style={{ ...type.bodyXs, color: theme.mutedText, margin: 0 }}>No active usage windows.</p>
          ) : (
            windows.map((row, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", ...type.bodyXs, color: theme.mutedText, marginBottom: 4 }}>
                <span>{row.label}</span>
                <span>{Math.round(row.window.usedPercent)}% used</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function NotificationsSection({ client }: { readonly client: MobileHostClient | null }): ReactElement {
  const { config, loading, setRendererSeverity } = useNotificationConfig(client);
  const [permission, setPermission] = useState(getNotificationPermission);
  const secureBlocked = isNotificationsSecureContextBlocked();

  return (
    <section style={{ marginBottom: 24 }}>
      <SectionHeading>Notifications</SectionHeading>

      <div style={{ marginBottom: 12 }}>
        <div style={{ ...type.bodySm, color: theme.text, marginBottom: 4 }}>Browser alerts</div>
        {secureBlocked ? (
          <p style={{ ...type.bodyXs, color: theme.mutedText, margin: 0 }}>
            Needs a secure (HTTPS) connection — not available on this origin.
          </p>
        ) : permission === "granted" ? (
          <p style={{ ...type.bodyXs, color: theme.mutedText, margin: 0 }}>Enabled.</p>
        ) : permission === "unsupported" ? (
          <p style={{ ...type.bodyXs, color: theme.mutedText, margin: 0 }}>Not supported in this browser.</p>
        ) : (
          <button
            type="button"
            onClick={() => void requestNotificationPermission().then(setPermission)}
            style={{
              minHeight: 36,
              padding: "0 12px",
              borderRadius: radius.md,
              borderWidth: 1,
              borderStyle: "solid",
              borderColor: theme.border,
              background: "transparent",
              color: theme.text,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            Enable browser alerts
          </button>
        )}
      </div>

      <div style={{ ...type.bodySm, color: theme.text, marginBottom: 6 }}>Notify me for</div>
      {loading || config === null ? (
        <p style={{ ...type.bodyXs, color: theme.mutedText }}>Loading…</p>
      ) : (
        (Object.keys(SEVERITY_LABELS) as HostNotificationSeverity[]).map((severity) => (
          <label
            key={severity}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              minHeight: 36,
              ...type.bodyXs,
              color: theme.text,
            }}
          >
            <input
              type="checkbox"
              checked={config.matrix[severity]?.renderer ?? false}
              onChange={(e) => void setRendererSeverity(severity, e.target.checked)}
            />
            {SEVERITY_LABELS[severity]}
          </label>
        ))
      )}
      <p style={{ ...type.bodyXs, color: theme.mutedText, marginTop: 6 }}>
        Email delivery is configured on the desktop app — not shown here.
      </p>
    </section>
  );
}

const WAKE_LOCK_OPTIONS: ReadonlyArray<{
  readonly value: WakeLockPreference;
  readonly label: string;
}> = [
  { value: "always", label: "Always while the app is open" },
  { value: "while-running", label: "Only while an agent is running" },
  { value: "off", label: "Off" },
];

/**
 * Hidden entirely where the Screen Wake Lock API is unsupported — a control
 * that silently does nothing is worse than no control.
 */
function DisplaySection(): ReactElement | null {
  const preference = useWakeLockPreference();
  if (!isWakeLockSupported()) return null;

  return (
    <section style={{ marginBottom: 24 }}>
      <SectionHeading>Display</SectionHeading>
      <div style={{ ...type.bodyXs, color: theme.mutedText, margin: "0 0 10px" }}>
        Keep the screen on so a run stays visible.{" "}
        <strong style={{ color: theme.text }}>Uses significantly more battery</strong> — the screen
        costs more power than everything else in this app combined.
      </div>
      {WAKE_LOCK_OPTIONS.map((option) => {
        const selected = preference === option.value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            onClick={() => writeWakeLockPreference(option.value)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              width: "100%",
              minHeight: 44,
              padding: "0 4px",
              border: "none",
              borderTop: `1px solid ${theme.borderHairline}`,
              background: "transparent",
              color: theme.text,
              fontSize: 14,
              fontFamily: "inherit",
              textAlign: "left",
              cursor: "pointer",
            }}
          >
            <span style={{ flex: 1 }}>{option.label}</span>
            {selected && <Check size={16} color={theme.primary} aria-hidden="true" />}
          </button>
        );
      })}
    </section>
  );
}

function AboutSection({
  client,
  onSignOut,
}: {
  readonly client: MobileHostClient | null;
  readonly onSignOut: () => void;
}): ReactElement {
  const { status } = useHostStatus(client);

  return (
    <section style={{ marginBottom: 24 }}>
      <SectionHeading>About</SectionHeading>
      <div style={{ ...type.bodyXs, color: theme.mutedText, marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
        <Wifi size={12} aria-hidden="true" />
        {HOST_WS_URL ?? "No host configured"}
      </div>
      {status !== null && (
        <div style={{ ...type.bodyXs, color: theme.mutedText, marginBottom: 12 }}>
          Host v{status.hostVersion} · protocol {status.protocolVersion.major}.{status.protocolVersion.minor}
        </div>
      )}
      <button
        type="button"
        onClick={onSignOut}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          minHeight: 44,
          padding: "0 4px",
          border: "none",
          borderTop: `1px solid ${theme.borderHairline}`,
          background: "transparent",
          color: theme.danger,
          fontSize: 14,
          cursor: "pointer",
          width: "100%",
          textAlign: "left",
        }}
      >
        <LogOut size={16} aria-hidden="true" />
        Sign out
      </button>
    </section>
  );
}
