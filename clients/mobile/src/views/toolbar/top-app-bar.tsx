/**
 * The app-level top bar — reachable from every screen, ABOVE each screen's
 * own header (which keeps its existing back button/title/connection pill;
 * unifying those into this bar too is a larger visual refactor across
 * already-solid screens, deliberately deferred — see the toolbar's status
 * report). Left: wordmark. Right: usage chip → UsageSheet, bell →
 * NotificationsScreen, avatar → AccountSheet.
 *
 * The usage chip is a plain icon here (not the live mini-gauge desktop's
 * spec describes) — polling `host.getRateLimitUsage` continuously just for
 * a top-bar glyph on every screen is a lot of background RPC traffic for a
 * rarely-glanced-at element; the real gauges render once the sheet opens.
 * Flagged simplification, not a silent omission.
 */
import { Gauge } from "lucide-react";
import type { ReactElement } from "react";
import type { HostNotificationsSummary } from "@traycer/protocol/host/notifications/host-notifications";
import type { AuthenticatedUser } from "@traycer/protocol/auth";
import { theme } from "@/views/design-tokens";
import { NotificationBell } from "./notification-bell";

export interface TopAppBarProps {
  readonly user: AuthenticatedUser | null;
  readonly notificationsSummary: HostNotificationsSummary | null;
  readonly onOpenUsage: () => void;
  readonly onOpenNotifications: () => void;
  readonly onOpenAccount: () => void;
}

function computeInitials(name: string | null, email: string | null): string {
  const source = (name ?? email ?? "").trim();
  if (source.length === 0) return "?";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

export function TopAppBar({
  user,
  notificationsSummary,
  onOpenUsage,
  onOpenNotifications,
  onOpenAccount,
}: TopAppBarProps): ReactElement {
  return (
    <div
      style={{
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        gap: 6,
        height: 48,
        padding: "0 12px",
        maxWidth: 480,
        margin: "0 auto",
        width: "100%",
        boxSizing: "border-box",
        borderBottom: `1px solid ${theme.borderHairline}`,
        background: theme.background,
      }}
    >
      <span style={{ fontWeight: 700, fontSize: 14, color: theme.text, letterSpacing: "-0.01em" }}>Traycer</span>
      <div style={{ flex: 1 }} />
      <button
        type="button"
        aria-label="Usage"
        onClick={onOpenUsage}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 36,
          height: 36,
          border: "none",
          background: "transparent",
          color: theme.text,
          cursor: "pointer",
          flexShrink: 0,
        }}
      >
        <Gauge size={17} aria-hidden="true" />
      </button>
      <NotificationBell summary={notificationsSummary} onClick={onOpenNotifications} />
      <button
        type="button"
        aria-label="Account"
        onClick={onOpenAccount}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 28,
          height: 28,
          borderRadius: "50%",
          border: "none",
          background: "color-mix(in oklch, var(--primary) 20%, transparent)",
          color: theme.primary,
          fontSize: 11,
          fontWeight: 700,
          cursor: "pointer",
          flexShrink: 0,
        }}
      >
        {user?.user.avatarUrl != null ? (
          <img src={user.user.avatarUrl} alt="" style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover" }} />
        ) : (
          computeInitials(user?.user.name ?? null, user?.user.email ?? null)
        )}
      </button>
    </div>
  );
}
