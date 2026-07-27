/**
 * Sprint 5 (C): the ONLY place `Notification.requestPermission()` is called
 * from — an explicit tap, never on load or auto-triggered by a blocked-state
 * transition. Shared by `EpicView` and `ChatView` (F8: both views can grant
 * permission, not just the epic-level one).
 */
import { useState, type CSSProperties, type ReactElement } from "react";
import {
  getNotificationPermission,
  requestNotificationPermission,
} from "@/host/notifications";
import { radius, theme } from "./design-tokens";
import { secondaryButton } from "./ui";

export interface NotificationPermissionButtonProps {
  /** A tight inline chip for a toolbar row (P1) rather than a full-width block. */
  readonly compact?: boolean;
}

export function NotificationPermissionButton({
  compact = false,
}: NotificationPermissionButtonProps = {}): ReactElement | null {
  const [permission, setPermission] = useState(getNotificationPermission);

  if (permission === "unsupported" || permission === "granted") {
    return null;
  }

  const style: CSSProperties = compact
    ? {
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        minHeight: 44,
        padding: "0 12px",
        borderRadius: radius.md,
        border: `1px solid ${theme.border}`,
        background: "transparent",
        color: theme.text,
        fontSize: 13,
        whiteSpace: "nowrap",
        cursor: "pointer",
      }
    : { ...secondaryButton, minHeight: 44, marginBottom: 12 };

  return (
    <button
      type="button"
      style={style}
      onClick={() => {
        void requestNotificationPermission().then(setPermission);
      }}
    >
      {compact ? "Enable alerts" : "Enable alerts for blocked chats"}
    </button>
  );
}
