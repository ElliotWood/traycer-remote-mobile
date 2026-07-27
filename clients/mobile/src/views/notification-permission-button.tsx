/**
 * Sprint 5 (C): the ONLY place `Notification.requestPermission()` is called
 * from — an explicit tap, never on load or auto-triggered by a blocked-state
 * transition. Shared by `EpicView` and `ChatView` (F8: both views can grant
 * permission, not just the epic-level one).
 */
import { useState, type ReactElement } from "react";
import {
  getNotificationPermission,
  requestNotificationPermission,
} from "@/host/notifications";
import { secondaryButton } from "./ui";

export function NotificationPermissionButton(): ReactElement | null {
  const [permission, setPermission] = useState(getNotificationPermission);

  if (permission === "unsupported" || permission === "granted") {
    return null;
  }

  return (
    <button
      type="button"
      style={{ ...secondaryButton, minHeight: 44, marginBottom: 12 }}
      onClick={() => {
        void requestNotificationPermission().then(setPermission);
      }}
    >
      Enable alerts for blocked chats
    </button>
  );
}
