/**
 * Asks for browser notification permission, from OUR shell.
 *
 * WHY THIS IS SHELL CODE AND NOT A SETTINGS TOGGLE. Upstream's notification
 * settings panel configures WHICH events notify; it has no concept of a
 * permission to display them at all, because the desktop shell it was written
 * for gets that from the OS at install time. On the web the grant is a
 * per-origin browser prompt that only a user gesture may trigger, and nothing
 * in `gui-app` exists to trigger it. Without this the whole notification path -
 * upstream's emission controller, `INotificationHost.show()`, the worker's
 * click routing - is built, wired, and permanently inert.
 *
 * THE PROMPT IS NOT FIRED ON LOAD, and that is not politeness. Chrome and
 * Firefox both ignore (Firefox) or hard-deny (Chrome, on repeat) a permission
 * request with no user activation behind it, and a denied origin cannot ask
 * again - so an unprompted request does not merely fail, it burns the grant.
 * The banner exists to put a real tap between the page and the request.
 *
 * THE OUTCOME IS EXTERNALLY READABLE at `<html data-notifications>`, with
 * `granted` / `denied` / `default` / `dismissed` / `unsupported` kept distinct.
 * Same device as `data-wake-lock` and `data-storage-durable`, for the same
 * reason: collapsing the negative states into one is how a later probe
 * concludes the feature works because an attribute was merely present.
 */

import { safeStorage } from "./safe-storage";
import { readNotificationPermission } from "./web-notification-host";

export const NOTIFICATION_PROMPT_DISMISSED_KEY =
  "traycer.next.notificationPromptDismissed";

export const NOTIFICATION_BANNER_TEXT =
  "Get notified when an agent needs you.";
export const NOTIFICATION_BANNER_ACTION = "Enable";
export const NOTIFICATION_BANNER_DISMISS = "Not now";
export const NOTIFICATION_BANNER_TESTID = "notification-permission-offer";

export type NotificationPermissionOutcome =
  | "granted"
  | "denied"
  | "default"
  | "dismissed"
  | "unsupported";

export interface OfferOptions {
  /** The element the banner is inserted before - the app's `#root`. */
  readonly container: HTMLElement;
  /** Defaults to reading `Notification.permission`. */
  readonly getPermission?: (() => string) | undefined;
  /** Defaults to `Notification.requestPermission()`. */
  readonly requestPermission?: (() => Promise<string>) | undefined;
  readonly read?: ((key: string) => string | null) | undefined;
  readonly write?: ((key: string, value: string) => void) | undefined;
  /** Reports the outcome. Defaults to stamping `<html data-notifications>`. */
  readonly report?: ((outcome: NotificationPermissionOutcome) => void) | undefined;
}

/**
 * Renders the offer when, and only when, a grant is still obtainable.
 *
 * Returns the banner element, or `null` when nothing was offered - which is the
 * common case and covers four genuinely different situations the report
 * distinguishes: already granted, already denied (the browser will not ask
 * again, so a banner would be a button that cannot work), previously dismissed,
 * and no `Notification` at all.
 */
export function offerNotificationPermission(
  options: OfferOptions,
): HTMLElement | null {
  const getPermission = options.getPermission ?? readNotificationPermission;
  const read = options.read ?? ((key: string) => safeStorage().getItem(key));
  const write =
    options.write ??
    ((key: string, value: string): void => {
      safeStorage().setItem(key, value);
    });
  const report =
    options.report ??
    ((outcome: NotificationPermissionOutcome): void => {
      document.documentElement.dataset.notifications = outcome;
    });

  const permission = getPermission();
  if (permission === "granted" || permission === "denied") {
    report(permission);
    return null;
  }
  if (permission !== "default") {
    // `readNotificationPermission` returns "unsupported" when the constructor
    // is absent - jsdom, insecure origins, and some cross-origin frame
    // configurations, which includes the Teams tab this same bundle serves.
    report("unsupported");
    return null;
  }
  if (read(NOTIFICATION_PROMPT_DISMISSED_KEY) !== null) {
    report("dismissed");
    return null;
  }

  report("default");
  return renderBanner(options.container, {
    onEnable: () => {
      const request =
        options.requestPermission ?? defaultRequestPermission;
      void request()
        .then((result) => {
          report(
            result === "granted" || result === "denied" ? result : "default",
          );
        })
        .catch(() => {
          // `requestPermission` rejects where the API exists but the surface
          // forbids it - a cross-origin frame without the `notifications`
          // permission policy, which is exactly what a Teams personal tab is.
          // Reported as unsupported rather than denied: the user did not
          // refuse, the surface did, and the two lead to different advice.
          report("unsupported");
        });
    },
    onDismiss: () => {
      write(NOTIFICATION_PROMPT_DISMISSED_KEY, "1");
      report("dismissed");
    },
  });
}

function defaultRequestPermission(): Promise<string> {
  const ctor = (
    globalThis as { Notification?: { requestPermission?: unknown } }
  ).Notification;
  const request = ctor?.requestPermission;
  if (typeof request !== "function") {
    return Promise.reject(new Error("Notification.requestPermission missing"));
  }
  // `.call(ctor)` because the method is defined on the constructor object.
  const result: unknown = (request as () => unknown).call(ctor);
  return Promise.resolve(result).then((value) =>
    typeof value === "string" ? value : "default",
  );
}

/**
 * Exported so the test asserts on the rendered element rather than on the fact
 * that a function was called - the same posture `pwa-shell.ts` takes with its
 * update banner.
 */
export function renderBanner(
  container: HTMLElement,
  handlers: { onEnable: () => void; onDismiss: () => void },
): HTMLElement | null {
  if (
    document.querySelector(`[data-testid="${NOTIFICATION_BANNER_TESTID}"]`) !==
    null
  ) {
    return null;
  }

  const banner = document.createElement("div");
  banner.setAttribute("role", "status");
  banner.dataset.testid = NOTIFICATION_BANNER_TESTID;
  banner.style.cssText =
    "display:flex;gap:12px;align-items:center;justify-content:center;" +
    "padding:10px 14px;font:13px/1.45 system-ui,sans-serif;" +
    "background:#0f2f22;color:#c8f5e3;border-bottom:1px solid #1e6b4f";

  const label = document.createElement("span");
  label.textContent = NOTIFICATION_BANNER_TEXT;

  const enable = document.createElement("button");
  enable.type = "button";
  enable.textContent = NOTIFICATION_BANNER_ACTION;
  enable.style.cssText =
    "font:inherit;font-weight:600;cursor:pointer;padding:4px 12px;" +
    "border-radius:6px;border:1px solid #2dd4a7;background:transparent;color:#2dd4a7";
  enable.addEventListener("click", () => {
    banner.remove();
    handlers.onEnable();
  });

  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.textContent = NOTIFICATION_BANNER_DISMISS;
  dismiss.style.cssText =
    "font:inherit;cursor:pointer;padding:4px 10px;border-radius:6px;" +
    "border:1px solid transparent;background:transparent;color:#8fbfad";
  dismiss.addEventListener("click", () => {
    banner.remove();
    handlers.onDismiss();
  });

  banner.append(label, enable, dismiss);
  container.before(banner);
  return banner;
}
