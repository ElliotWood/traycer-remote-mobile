/**
 * Sprint 5 (C): the ONLY place `Notification.requestPermission()` is called
 * from — an explicit tap, never on load or auto-triggered by a blocked-state
 * transition. Shared by `EpicView` and `ChatView` (F8: both views can grant
 * permission, not just the epic-level one).
 *
 * Push sprint: also drives the `PushManager` subscribe flow once permission
 * is granted, and surfaces the honest outcome — `subscribed`,
 * `permission-denied`, `service-unreachable`, or `unsupported` — rather than
 * a toggle that claims to be "on" when the subscribe call actually failed.
 */
import { useEffect, useState, type CSSProperties, type ReactElement } from "react";
import {
  getNotificationPermission,
  requestNotificationPermission,
  type NotificationPermissionState,
} from "@/host/notifications";
import { subscribeToPush, type PushSubscribeOutcome } from "@/host/push-subscription";
import { useAuthServiceOrNull } from "@/host/auth-service-context";
import type { MobileAuthService } from "@/host/auth-service";
import { radius, theme } from "./design-tokens";
import { secondaryButton } from "./ui";

export interface NotificationPermissionButtonProps {
  /** A tight inline chip for a toolbar row (P1) rather than a full-width block. */
  readonly compact?: boolean;
}

type ButtonState =
  | "hidden"
  | "prompt"
  | "permission-denied"
  | "subscribed"
  | "service-unreachable";

export function NotificationPermissionButton({
  compact = false,
}: NotificationPermissionButtonProps = {}): ReactElement | null {
  const auth = useAuthServiceOrNull();
  const [state, setState] = useState<ButtonState>(() =>
    initialStateFor(getNotificationPermission()),
  );

  useEffect(() => {
    // Permission can be granted without an active push subscription (e.g. a
    // prior subscribe attempt failed while the service was unreachable) —
    // reconcile against the real subscription rather than assuming "granted"
    // means "on".
    if (getNotificationPermission() !== "granted") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    let cancelled = false;
    navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then((subscription) => {
        if (!cancelled) setState(subscription !== null ? "subscribed" : "prompt");
      })
      .catch(() => {
        if (!cancelled) setState("prompt");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === "hidden" || state === "subscribed") {
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
        void handleTap(auth, setState);
      }}
    >
      {buttonLabel(state, compact)}
    </button>
  );
}

async function handleTap(
  auth: MobileAuthService | null,
  setState: (state: ButtonState) => void,
): Promise<void> {
  const permission = await requestNotificationPermission();
  if (permission !== "granted") {
    setState(permission === "denied" ? "permission-denied" : "prompt");
    return;
  }
  const bearer = currentBearerOrNull(auth);
  if (bearer === null) {
    setState("service-unreachable");
    return;
  }
  const outcome = await subscribeToPush(bearer);
  setState(outcomeToState(outcome));
}

function currentBearerOrNull(auth: MobileAuthService | null): string | null {
  if (auth === null) return null;
  try {
    return auth.bearerSource()?.getBearerToken() ?? null;
  } catch {
    return null;
  }
}

function initialStateFor(permission: NotificationPermissionState): ButtonState {
  switch (permission) {
    case "unsupported":
      return "hidden";
    case "denied":
      return "permission-denied";
    case "granted":
    case "default":
      return "prompt";
  }
}

function outcomeToState(outcome: PushSubscribeOutcome): ButtonState {
  switch (outcome.kind) {
    case "subscribed":
      return "subscribed";
    case "permission-denied":
      return "permission-denied";
    case "service-unreachable":
      return "service-unreachable";
    case "unsupported":
      return "hidden";
  }
}

function buttonLabel(state: ButtonState, compact: boolean): string {
  switch (state) {
    case "permission-denied":
      return compact ? "Alerts blocked" : "Notifications blocked — enable in browser settings";
    case "service-unreachable":
      return compact ? "Alerts unavailable" : "Push service unreachable — tap to retry";
    case "prompt":
    case "hidden":
    case "subscribed":
      return compact ? "Enable alerts" : "Enable alerts for blocked chats";
  }
}
