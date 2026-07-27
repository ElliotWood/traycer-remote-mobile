/**
 * The top-bar bell: grey dot (unknown, no summary yet) / clear (nothing) /
 * primary dot (quiet unread) / destructive count badge (attention) — mirrors
 * desktop's bell-state machine, computed from `summary` alone (see
 * `use-host-notifications.ts`).
 */
import { Bell } from "lucide-react";
import type { ReactElement } from "react";
import type { HostNotificationsSummary } from "@traycer/protocol/host/notifications/host-notifications";
import { theme } from "@/views/design-tokens";

export interface NotificationBellProps {
  readonly summary: HostNotificationsSummary | null;
  readonly onClick: () => void;
}

export function NotificationBell({ summary, onClick }: NotificationBellProps): ReactElement {
  const attentionCount = summary?.attentionCount ?? 0;
  const hasUnread = (summary?.unreadCount ?? 0) > 0;

  return (
    <button
      type="button"
      aria-label={attentionCount > 0 ? `Notifications, ${attentionCount} need attention` : "Notifications"}
      onClick={onClick}
      style={{
        position: "relative",
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
      <Bell size={18} aria-hidden="true" />
      {attentionCount > 0 ? (
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            top: 4,
            right: 4,
            minWidth: 14,
            height: 14,
            padding: "0 3px",
            borderRadius: 999,
            background: theme.danger,
            color: "#fff",
            fontSize: 9,
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {attentionCount > 9 ? "9+" : attentionCount}
        </span>
      ) : hasUnread ? (
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            top: 6,
            right: 6,
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: theme.primary,
          }}
        />
      ) : null}
    </button>
  );
}
