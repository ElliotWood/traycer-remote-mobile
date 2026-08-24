/**
 * `INotificationHost` for the web/Teams shell, backed by the service worker.
 *
 * WHAT THIS REPLACES, AND WHY IT IS THE WHOLE FEATURE. `mobile-runner-host.ts`
 * shipped a `buildNotifications()` whose `show()` voided all six arguments and
 * whose `onClick()` returned a disposable that never fired. Upstream calls that
 * `show()` unconditionally - `notification-display.ts` builds a V1 activation
 * envelope and hands it over on every notifiable row, with no desktop gate - so
 * the client has been silently discarding a fully-built notification pipeline.
 *
 * THE DEEP-LINK PROBLEM DISSOLVES HERE, and this is worth stating because the
 * ticket file scoped it as the hard part of push: *"the archived worker opened*
 * *`/?epicId=…&chatId=…`. Upstream's router is HASH-based at this deployment, so*
 * *that URL shape is wrong here and the right one is a question about gui-app's*
 * *routes."* It is not a question about gui-app's routes, because gui-app
 * already owns the answer: `RunnerHostBridges` subscribes to
 * `notifications.onClick` and `NotificationFocusBridge` routes the payload -
 * resolving the epic's tab, reopening a closed chat tile, guarding a switched
 * origin host. None of that is expressible as a URL, and none of it needs to be.
 * The payload is `unknown` at this boundary by design; it goes out through
 * `show()` and comes back through `onClick()` untouched, and upstream does the
 * routing it was already written to do.
 *
 * So this module deliberately parses nothing and constructs no route.
 *
 * NOT `new Notification(...)`. The constructor is unavailable in a service
 * worker context and throws outright on Android Chrome, where
 * `ServiceWorkerRegistration.showNotification` is the only path. Going through
 * the registration is also what makes a background `push` and a foreground
 * `show()` produce the same notification with the same click behaviour, rather
 * than two surfaces that drift.
 */
import type { Disposable } from "@traycer-clients/shared/platform/uri-callback";
import type { INotificationHost } from "@traycer-clients/shared/platform/runner-host";
import { currentWindow, isCrossOriginFramed } from "./embedding";

/**
 * The worker -> page message carrying a tapped notification's payload.
 *
 * DUPLICATED AS A LITERAL IN `sw.ts`, which cannot import it: the worker is a
 * classic script with no module system, deliberately (see its docblock). A
 * silent disagreement between the two spellings would produce a notification
 * that shows, taps, and does nothing - the failure mode with no error to read.
 * `sw.test.ts` therefore asserts the GENERATED worker text contains these exact
 * strings, so the duplication is checked rather than trusted.
 */
export const NOTIFICATION_CLICK_MESSAGE = "traycer:notification-click";

/** The page -> worker "my click listener is mounted" handshake. */
export const NOTIFICATION_CLIENT_READY_MESSAGE =
  "traycer:notification-client-ready";

/**
 * The page -> worker "I have routed this one" receipt.
 *
 * The worker keeps a click queued until this arrives, because a `postMessage`
 * to a window whose listener has not mounted is dropped silently - the exact
 * shape of a cold open. Without the ack the worker would have to choose between
 * losing that tap and redelivering every tap forever.
 */
export const NOTIFICATION_CLICK_ACK_MESSAGE = "traycer:notification-click-ack";

/**
 * The service-worker surface this module uses, named as the narrowest shape
 * that covers it - the same posture `pwa-shell.ts` takes and for the same
 * reason: the real DOM interfaces are assignable to these, so production passes
 * the genuine article while a test can construct one outright instead of
 * asserting a partial fake past an interface with fifty members it never
 * touches.
 */
export interface NotificationRegistrationLike {
  showNotification(
    title: string,
    options: {
      body: string;
      data: unknown;
      tag?: string | undefined;
    },
  ): Promise<void>;
}

export interface NotificationServiceWorkerLike {
  postMessage(message: unknown): void;
}

export interface NotificationServiceWorkerHost {
  readonly ready: Promise<NotificationRegistrationLike>;
  readonly controller: NotificationServiceWorkerLike | null;
  addEventListener(
    type: "message",
    listener: (event: { data: unknown }) => void,
  ): void;
  removeEventListener(
    type: "message",
    listener: (event: { data: unknown }) => void,
  ): void;
}

/**
 * What the last `show()` did, kept as distinct states for the same reason
 * `data-notifications`, `data-push` and `data-wake-lock` are: collapsing the
 * negative ones is how a later probe concludes the feature works because an
 * attribute was merely present.
 *
 * `permission` and `surface-blocked` are the pair that matters here, and they
 * are the same TRANSIENT/PERMANENT split `screen-wake-lock.ts` draws between
 * `unavailable` and `policy-blocked`. Both mean "not displayed"; they lead to
 * opposite next actions, and the retry policy above is decided by which one it
 * is.
 */
export type NativeNotifyOutcome =
  "idle" | "shown" | "surface-blocked" | "permission" | "no-worker";

export interface WebNotificationHostOptions {
  /** Defaults to `navigator.serviceWorker`. Injected in tests. */
  readonly serviceWorker?: NotificationServiceWorkerHost | undefined;
  /** Defaults to reading `Notification.permission`. Injected in tests. */
  readonly getPermission?: (() => string) | undefined;
  /**
   * Is native display structurally impossible on this surface, rather than
   * merely ungranted right now?
   *
   * Defaults to the cross-origin-embedded reading, which is the same
   * `embedding.ts` that `notification-permission.ts` uses and the same
   * measurement behind it: in a cross-origin frame `Notification.permission`
   * reads `denied` at load, and an explicit `allow="notifications *"` from the
   * parent does NOT restore it. So this is not a missing attribute an embedder
   * could add - it is fixed for the life of the document.
   */
  readonly isSurfaceBlocked?: (() => boolean) | undefined;
  /** Defaults to writing `<html data-native-notify>`. Injected in tests. */
  readonly report?: ((outcome: NativeNotifyOutcome) => void) | undefined;
}

/**
 * Writes the outcome where a probe on the real install can read it.
 *
 * Guarded rather than assumed: this module runs in jsdom and in a service
 * worker's page context, and a missing `document` must not turn a notification
 * failure into a second, unrelated throw out of the reporting line.
 */
function defaultReport(outcome: NativeNotifyOutcome): void {
  const scope: { readonly document?: { documentElement?: HTMLElement } } =
    globalThis;
  const root = scope.document?.documentElement;
  if (root === undefined) return;
  root.dataset.nativeNotify = outcome;
}

/**
 * Reads `Notification.permission` without assuming `Notification` exists.
 *
 * It is absent in jsdom, on insecure origins, and in a cross-origin iframe
 * under some configurations - which includes the Teams tab, the surface this
 * bundle also serves. A bare `Notification.permission` is a `ReferenceError`
 * there, thrown out of whatever called `show()`.
 */
export function readNotificationPermission(): string {
  const ctor = (globalThis as { Notification?: { permission?: unknown } })
    .Notification;
  if (ctor === undefined) return "unsupported";
  return typeof ctor.permission === "string" ? ctor.permission : "unsupported";
}

/**
 * `show()` REJECTS rather than resolving when it cannot display, and that is a
 * behavioural decision rather than an idiom.
 *
 * Upstream's `NotificationEmissionController` records a display receipt in
 * `.then()` and, in `.catch()`, says so in its own words: *"Keep the receipt*
 * *pending so a later mount can retry native display."* A resolve-anyway
 * implementation would mark every undisplayed notification as delivered, so
 * granting permission later would surface nothing and the backlog would be
 * permanently swallowed. The in-app toast is unaffected either way -
 * `notification-display.ts` renders it before awaiting this promise.
 *
 * ## The one surface where that reasoning inverts, and it is the Teams tab
 *
 * The paragraph above is correct wherever the denial is TRANSIENT, and it is
 * the whole argument for rejecting. It rests on there being a "later" - a
 * mount at which the grant might have changed. **In a cross-origin frame there
 * is not one.** `Notification.permission` reads `denied` at load, and
 * `allow="notifications *"` from the parent does not restore it (measured,
 * four arms, recorded in `notification-permission.ts`). No user action, no
 * manifest change and no embedder attribute reaches it.
 *
 * So on that surface rejecting asserts *"retry later will work"* about
 * something measured never to work, and upstream believes it. MEASURED against
 * upstream's REAL controller and this REAL host, both halves unmocked
 * (`native-notify-retry.test.tsx`):
 *
 * | arm                          | toasts for row 1 after 2 more arrivals |
 * | ---------------------------- | -------------------------------------- |
 * | `granted` - CONTROL          | **1**                                  |
 * | permanently blocked          | **3**                                  |
 *
 * The receipt is never recorded, so the row stays in the pending set forever
 * and EVERY later arrival re-drains the whole backlog: with a day's
 * notifications behind it, one new notification re-toasts all of them, each
 * with a chime, and the set only grows. The control is what makes that a
 * defect rather than a description - a granted surface displays once and stops.
 *
 * **So a permanent block RESOLVES.** The receipt's meaning is "this row has
 * been through the display path; do not replay it", and on a surface with no
 * native channel and a toast already rendered, that is simply true. Resolving
 * is not a claim that the OS drew a notification; rejecting is a claim about a
 * future that was measured not to exist, which is the more expensive lie.
 *
 * The split is `screen-wake-lock.ts`'s `policy-blocked` vs `unavailable`
 * arriving one module over: same failure, opposite next actions, and the bug
 * both times was one reading standing for both.
 */
export function createWebNotificationHost(
  options: WebNotificationHostOptions,
): INotificationHost {
  // Annotated rather than inferred. Left to inference this is the UNION of the
  // injected shape and the DOM's `ServiceWorkerContainer`, and a call against a
  // union must satisfy every member's overloads - so `addEventListener` stops
  // resolving. The real container is assignable to the narrow interface, which
  // is the property that matters and the one this annotation asserts.
  const container: NotificationServiceWorkerHost | undefined =
    options.serviceWorker ?? globalThis.navigator?.serviceWorker ?? undefined;
  const getPermission = options.getPermission ?? readNotificationPermission;
  const isSurfaceBlocked =
    options.isSurfaceBlocked ??
    ((): boolean => isCrossOriginFramed(currentWindow()));
  const report = options.report ?? defaultReport;

  // Stamped at CONSTRUCTION, before anything has been asked of this host.
  //
  // Without it the attribute is simply absent until the first notification
  // arrives, and absent reads identically to "an older bundle with no such
  // module", "a boot path that threw before reaching it" and "working, just
  // never exercised". That is the same three-state gap `data-push` carried on
  // this exact surface, and a notification is precisely the event that may
  // never happen on a quiet day - so the silent window here is unbounded.
  report("idle");

  return {
    show: async (
      title,
      body,
      payload,
      replaceKey,
      deliveryKey,
      foregroundAppLocal,
    ): Promise<void> => {
      // Desktop-only, and voided rather than approximated. `deliveryKey`
      // deduplicates a delivery across Electron windows and
      // `foregroundAppLocal` relays app-local state to whichever renderer owns
      // the foreground; a browser tab has one surface and no sibling realm, so
      // there is nothing here for either to address. `mobile-runner-host.ts`
      // records the same reasoning against `onForegroundDisplay`.
      void deliveryKey;
      void foregroundAppLocal;

      if (container === undefined) {
        report("no-worker");
        throw new Error("notifications: no service worker on this client");
      }
      const permission = getPermission();
      if (permission !== "granted") {
        // The whole of the transient/permanent split, and the ORDER is
        // load-bearing: the surface question is asked only once the permission
        // has already failed. A surface that is embedded AND granted - which a
        // same-origin frame is, measured - must take the normal path and
        // display, so this can never withhold a notification from a surface
        // that would have shown one.
        if (isSurfaceBlocked()) {
          report("surface-blocked");
          return;
        }
        report("permission");
        throw new Error(`notifications: permission is "${permission}"`);
      }
      const registration = await container.ready;
      await registration.showNotification(title, {
        body,
        // The payload travels opaquely and comes back through `onClick`
        // untouched. `null` is a legitimate value - upstream sends it for a
        // row with nowhere to route - and it must survive as `null` rather
        // than becoming `undefined`, because the focus bridge distinguishes
        // "unroutable" from "unknown" and opens the notification center for
        // one and not the other.
        data: payload,
        // `replaceKey` -> `tag` is the exact semantic: a tagged notification
        // replaces the one already on screen with the same tag. Left undefined
        // when there is no key, so untagged notifications stack rather than
        // silently collapsing onto one another.
        tag: replaceKey ?? undefined,
      });
      // AFTER the await, so it reports a notification the worker accepted
      // rather than one this module merely asked for.
      report("shown");
    },

    onClick: (handler): Disposable => {
      if (container === undefined) return { dispose: (): void => undefined };

      // The worker redelivers an unacknowledged click on a timer, and flushes
      // the whole queue to every open window. Both are deliberate on that side
      // (a dropped message is invisible; a lost tap is the failure this feature
      // exists to prevent), and both mean the same click can arrive here more
      // than once. Routing it twice would navigate the user somewhere they
      // already are, so the id is what makes redelivery safe rather than merely
      // frequent.
      const routed = new Set<string>();

      const listener = (event: { data: unknown }): void => {
        const message = asClickMessage(event.data);
        if (message === null) return;
        // Acknowledged BEFORE routing, not after. The ack means "this page has
        // it", which is true at this point; deferring it until after `handler`
        // would leave the entry queued for the length of a navigation and let
        // the worker's next tick deliver it again.
        container.controller?.postMessage({
          type: NOTIFICATION_CLICK_ACK_MESSAGE,
          id: message.id,
        });
        if (message.id !== null) {
          if (routed.has(message.id)) return;
          routed.add(message.id);
        }
        handler(message.payload);
      };
      container.addEventListener("message", listener);

      // The cold-open half. A tap on a notification while the app is CLOSED
      // makes the worker open a window; the payload cannot be delivered until
      // this listener exists, and the worker has no way to observe that from
      // its side. So the page announces itself and the worker replies with
      // whatever it is holding. Without this the app opens on the fleet view
      // and the tap is silently discarded - which is the single most likely
      // path for a background push, since app-closed is what background push
      // is for.
      container.controller?.postMessage({
        type: NOTIFICATION_CLIENT_READY_MESSAGE,
      });

      return {
        dispose: (): void => {
          container.removeEventListener("message", listener);
        },
      };
    },

    onForegroundDisplay: (handler): Disposable => {
      // The cross-window relay exists because a desktop shell can have another
      // Traycer window focused. A browser tab shows one surface at a time, so
      // nothing ever emits here - unchanged from the no-op this module
      // replaces.
      void handler;
      return { dispose: (): void => undefined };
    },
  };
}

/** `null` for anything that is not our click message - including a message from another library sharing this worker's page. */
function asClickMessage(
  data: unknown,
): { id: string | null; payload: unknown } | null {
  if (data === null || typeof data !== "object") return null;
  const record: Record<string, unknown> = { ...data };
  if (record.type !== NOTIFICATION_CLICK_MESSAGE) return null;
  // `payload` is deliberately read without validation: it is `unknown` at this
  // boundary by contract, and upstream's `parseNotificationActivationPayload`
  // is the thing that decides whether it is a V1 envelope, a legacy payload or
  // unknown. Narrowing it here would mean two parsers disagreeing.
  return {
    id: typeof record.id === "string" ? record.id : null,
    payload: record.payload,
  };
}
