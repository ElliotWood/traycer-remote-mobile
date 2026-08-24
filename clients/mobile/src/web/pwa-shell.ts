/**
 * Registers the service worker and offers the new version when one arrives.
 *
 * Lives in OUR shell and touches no React, for the same reason
 * `announceNonDurableStorage` does: this bundle is upstream's `gui-app`, and
 * the PWA layer is ours. Nothing here costs upstream's UI a line.
 *
 * THE BANNER IS NOT DECORATION. The worker installs and waits rather than
 * self-activating (see `sw.ts`), so without something to tap, a user on a
 * precached shell would sit on the old build until they happened to close
 * every tab. An update mechanism whose only trigger is the user guessing is
 * not an update mechanism.
 */

/** Text kept here rather than inline so the test asserts on the shipped copy. */
export const UPDATE_BANNER_TEXT = "A new version of Traycer is ready.";
export const UPDATE_BANNER_ACTION = "Refresh";
export const UPDATE_BANNER_TESTID = "pwa-update-available";

/**
 * The service-worker surface this module uses, named as the narrowest shape
 * that covers it. `ServiceWorkerContainer` and friends are assignable to these,
 * so production passes the real thing; a test can build one outright instead of
 * asserting a partial fake past a DOM interface with fifty members it never
 * touches. The assertion is what would hide a drift, so there isn't one.
 */
export interface ServiceWorkerLike {
  readonly state: string;
  postMessage(message: unknown): void;
  addEventListener(type: "statechange", listener: () => void): void;
}

export interface ServiceWorkerRegistrationLike {
  readonly waiting: ServiceWorkerLike | null;
  readonly installing: ServiceWorkerLike | null;
  addEventListener(type: "updatefound", listener: () => void): void;
}

export interface ServiceWorkerHost {
  readonly controller: ServiceWorkerLike | null;
  register(
    scriptUrl: string,
    options: { scope: string },
  ): Promise<ServiceWorkerRegistrationLike>;
  addEventListener(type: "controllerchange", listener: () => void): void;
}

export interface RegisterOptions {
  /** The element the banner is inserted before - the app's `#root`. */
  readonly container: HTMLElement;
  /** Defaults to `navigator.serviceWorker`. Injected in tests. */
  readonly serviceWorker?: ServiceWorkerHost | undefined;
  readonly reload?: () => void;
}

/**
 * `void` and never throws. A failed registration means no offline support,
 * which is a degradation; letting it reject would be a boot failure, which is
 * an outage. Registration DOES reject in a storage-denied third-party frame -
 * i.e. exactly the Teams tab configuration this bundle already handles
 * elsewhere - so this is a real path, not defensive padding.
 */
export function registerServiceWorker(options: RegisterOptions): void {
  const container: ServiceWorkerHost | undefined =
    options.serviceWorker ?? globalThis.navigator.serviceWorker;
  // Typed as always present, absent in reality on http origins, in some
  // private modes, and in jsdom. The type is what is optimistic here.
  if (container === undefined) {
    document.documentElement.dataset.pwa = "unsupported";
    return;
  }

  const reload = options.reload ?? ((): void => globalThis.location.reload());

  // Set at the moment the user taps, and read by the `controllerchange`
  // handler. WITHOUT IT this reloads on a controller change the user never
  // asked for - the failure the retired client shipped, where a first-install
  // `clients.claim()` fired `controllerchange` and the page reloaded once for
  // every user with nothing to show them. `sw.ts` no longer claims; this is
  // the second, independent guard, because "no other code fires this event"
  // is the kind of premise that quietly stops being true.
  let updateRequested = false;

  container.addEventListener("controllerchange", () => {
    if (!updateRequested) return;
    reload();
  });

  void container
    .register(swScriptUrl(), { scope: "./" })
    .then((registration) => {
      document.documentElement.dataset.pwa = "registered";

      const offer = (worker: ServiceWorkerLike): void => {
        // `controller === null` means no worker was controlling this page, so
        // this is a FIRST install, not an update: there is no old version to
        // move off and nothing to tell the user about.
        if (container.controller === null) return;
        showUpdateBanner(options.container, () => {
          updateRequested = true;
          worker.postMessage({ type: "SKIP_WAITING" });
        });
      };

      // Already waiting when the page loaded - a worker installed during a
      // previous visit that was never activated.
      if (registration.waiting !== null) offer(registration.waiting);

      registration.addEventListener("updatefound", () => {
        const installing = registration.installing;
        if (installing === null) return;
        installing.addEventListener("statechange", () => {
          if (installing.state === "installed") offer(installing);
        });
      });
    })
    .catch(() => {
      document.documentElement.dataset.pwa = "unavailable";
    });
}

/**
 * `sw.js` sits beside `index.html` at the deployment base, so a relative URL
 * is both correct and base-agnostic. An absolute `/sw.js` would register at the
 * ORIGIN root - scope `/`, a scope this app does not own and shares with `/`
 * and `/tab/`, two other deployed surfaces on the same host.
 */
function swScriptUrl(): string {
  return new URL("sw.js", document.baseURI).href;
}

/**
 * Exported for the test, which asserts on the rendered element rather than on
 * the fact that a function was called.
 */
export function showUpdateBanner(
  container: HTMLElement,
  onRefresh: () => void,
): HTMLElement | null {
  if (
    document.querySelector(`[data-testid="${UPDATE_BANNER_TESTID}"]`) !== null
  ) {
    return null;
  }

  const banner = document.createElement("div");
  banner.setAttribute("role", "status");
  banner.dataset.testid = UPDATE_BANNER_TESTID;
  banner.style.cssText =
    "display:flex;gap:12px;align-items:center;justify-content:center;" +
    "padding:10px 14px;font:13px/1.45 system-ui,sans-serif;" +
    "background:#0f2f22;color:#c8f5e3;border-bottom:1px solid #1e6b4f";

  const label = document.createElement("span");
  label.textContent = UPDATE_BANNER_TEXT;

  const button = document.createElement("button");
  button.type = "button";
  button.textContent = UPDATE_BANNER_ACTION;
  button.style.cssText =
    "font:inherit;font-weight:600;cursor:pointer;padding:4px 12px;" +
    "border-radius:6px;border:1px solid #2dd4a7;background:transparent;color:#2dd4a7";
  button.addEventListener("click", onRefresh);

  banner.append(label, button);
  container.before(banner);
  return banner;
}
