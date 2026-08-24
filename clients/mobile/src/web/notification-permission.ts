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
 * `granted` / `denied` / `default` / `dismissed` / `unsupported` /
 * `surface-blocked` kept distinct. Same device as `data-wake-lock` and
 * `data-storage-durable`, for the same reason: collapsing the negative states
 * into one is how a later probe concludes the feature works because an
 * attribute was merely present.
 *
 * ## `surface-blocked`, and why it is a sixth outcome rather than a sixth word
 *
 * This file's own `.catch()` below already says the distinction that matters:
 * *"the user did not refuse, the surface did, and the two lead to different
 * advice."* That reasoning was right and it was implemented on the wrong path.
 * **The Teams tab never reaches the request at all.**
 *
 * MEASURED, Chromium 1228, notifications GRANTED to the app's origin:
 *
 * | arm                     | `Notification.permission` at load |
 * | ----------------------- | --------------------------------- |
 * | top level (control)     | `granted`                         |
 * | same-origin iframe      | `granted`                         |
 * | **cross-origin iframe** | **`denied`**                      |
 * | cross-origin + `allow="notifications *"` | **`denied`**     |
 *
 * So in a Teams tab the permission reads `denied` BEFORE anything is offered,
 * the early return below fires, and the shell reported `denied` - which means
 * *"the user said no"* about a user who was never asked, on a surface where the
 * grant was in fact held. A reader of `data-notifications` on the deployed tab
 * would send that user to their browser settings, which cannot help.
 *
 * **The fourth row is the one that closes the question rather than merely
 * describing it.** Delegating the feature explicitly from the parent does not
 * restore it, so this is not a missing `allow` attribute that Teams could add
 * and not something a manifest change can reach. Web notifications are
 * structurally unavailable to this bundle whenever it is embedded, which is
 * what makes the Teams interrupt channel a different capability rather than a
 * worse-configured version of this one.
 */

import { currentWindow, isCrossOriginFramed } from "./embedding";
import { safeStorage } from "./safe-storage";
import { readNotificationPermission } from "./web-notification-host";

export const NOTIFICATION_PROMPT_DISMISSED_KEY =
  "traycer.next.notificationPromptDismissed";

/**
 * A SECOND key, deliberately. Dismissing "not now" on the offer and dismissing
 * the embedded note are different statements about different surfaces, and one
 * browser profile can be both: the PWA at the top level and the Teams tab share
 * an origin and therefore share storage. Reusing one key would let a dismissal
 * in Teams silently suppress the offer in the browser tab the note tells the
 * user to open - the note disabling its own advice.
 */
export const EMBEDDED_NOTE_DISMISSED_KEY =
  "traycer.next.embeddedNotificationNoteDismissed";

export const NOTIFICATION_BANNER_TEXT = "Get notified when an agent needs you.";
export const NOTIFICATION_BANNER_ACTION = "Enable";
export const NOTIFICATION_BANNER_DISMISS = "Not now";
export const NOTIFICATION_BANNER_TESTID = "notification-permission-offer";

/**
 * Names the effect, and deliberately does not name Teams.
 *
 * This module knows it is cross-origin embedded; it does NOT know it is in
 * Teams. The SDK handshake is the only thing that knows, it is dynamic-imported
 * and raced against 4s, and nothing here may wait on it. Copy that said "Teams"
 * would be a guess presented to a user as a fact on any other embedder.
 *
 * It also does not say notifications will arrive some other way. The bot's
 * proactive send path is built and has never sent anything, so promising it
 * here would be a sentence that reads like a working feature and is not one.
 * What is offered instead is true today and the user can act on it now.
 */
export const EMBEDDED_NOTE_TEXT =
  "Notifications are blocked while Traycer runs inside another app. " +
  "Open Traycer in a browser tab to be notified when an agent needs you.";
export const EMBEDDED_NOTE_DISMISS = "Got it";
export const EMBEDDED_NOTE_TESTID = "notification-embedded-note";

export type NotificationPermissionOutcome =
  | "granted"
  | "denied"
  | "default"
  | "dismissed"
  | "unsupported"
  /** The surface refuses, and no user was asked. See the docblock. */
  | "surface-blocked";

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
  readonly report?:
    ((outcome: NotificationPermissionOutcome) => void) | undefined;
  /**
   * Defaults to the real cross-origin test. Injected so a test can hold the
   * surface fixed while varying the permission, which is the only way to show
   * that the same `denied` reading produces two different outcomes.
   */
  readonly isEmbedded?: (() => boolean) | undefined;
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

  const isEmbedded =
    options.isEmbedded ?? ((): boolean => isCrossOriginFramed(currentWindow()));

  const permission = getPermission();

  // BEFORE the granted/denied early return, because the reading it re-attributes
  // is `denied` - and only `denied`. A cross-origin frame never reads `granted`
  // (measured, all three arms), so re-attributing that one would be a branch
  // for a state the platform does not produce, which is worse than no branch:
  // it would look tested.
  if (permission === "denied" && isEmbedded()) {
    report("surface-blocked");
    if (read(EMBEDDED_NOTE_DISMISSED_KEY) !== null) return null;
    return renderEmbeddedNote(options.container, {
      onDismiss: () => {
        write(EMBEDDED_NOTE_DISMISSED_KEY, "1");
      },
    });
  }

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
      const request = options.requestPermission ?? defaultRequestPermission;
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

/**
 * The embedded note: what the offer becomes on a surface that cannot grant.
 *
 * ONE ACTION, and it is not "Enable". There is nothing to enable - the request
 * is refused by the surface and cannot be re-asked - so an Enable button here
 * would be this project's signature bug (*"the button did nothing"*) rendered
 * deliberately. The only honest control is acknowledging it.
 *
 * The dismissal is remembered but does NOT change what is reported: the note
 * going away does not mean notifications started working, and
 * `data-notifications` describes the platform rather than the banner. That
 * ordering is asserted by a test, because the offer path above does the
 * opposite - `dismissed` there really is the final outcome - and two paths that
 * differ on purpose are exactly where a later edit collapses them.
 */
export function renderEmbeddedNote(
  container: HTMLElement,
  handlers: { onDismiss: () => void },
): HTMLElement | null {
  if (
    document.querySelector(`[data-testid="${EMBEDDED_NOTE_TESTID}"]`) !== null
  ) {
    return null;
  }

  const note = document.createElement("div");
  note.setAttribute("role", "status");
  note.dataset.testid = EMBEDDED_NOTE_TESTID;
  note.style.cssText =
    "display:flex;gap:12px;align-items:center;justify-content:center;" +
    "padding:10px 14px;font:13px/1.45 system-ui,sans-serif;" +
    "background:#1e2a38;color:#c5d8ea;border-bottom:1px solid #35506b";

  const label = document.createElement("span");
  label.textContent = EMBEDDED_NOTE_TEXT;

  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.textContent = EMBEDDED_NOTE_DISMISS;
  dismiss.style.cssText =
    "font:inherit;cursor:pointer;padding:4px 10px;border-radius:6px;" +
    "border:1px solid transparent;background:transparent;color:#8fb4d8";
  dismiss.addEventListener("click", () => {
    note.remove();
    handlers.onDismiss();
  });

  note.append(label, dismiss);
  container.before(note);
  return note;
}
