/**
 * The `/next/` service worker: an app-shell precache so the client opens
 * without a network, and nothing else.
 *
 * P2 of `convergence-architecture` - "port our service worker, offline cache,
 * push, wake lock onto it". This file is the first two. The retired
 * `clients/mobile/src/sw.ts` is its reference, but this is a rewrite rather
 * than a copy, for one reason worth stating: that worker was a Workbox
 * `injectManifest` build, and Workbox's precache list came from a
 * hand-maintained glob. The glob is what broke, twice. Here the list is read
 * out of the built `index.html` (see `precache-list.ts`) and injected below,
 * which removes the dependency AND the defect at the same time.
 *
 * WRITTEN AS A CLASSIC WORKER SCRIPT - no `import`, no `export`. That is not
 * style: a module service worker (`{type:"module"}`) is unsupported in Firefox
 * before 133 and in older Android WebViews, and a registration that silently
 * fails there would take offline support with it on exactly the devices this
 * feature is for. `tools/build-sw.mjs` therefore only has to strip types, not
 * bundle - so there is no bundler in this path to go stale.
 *
 * Type-checked by `tsconfig.sw.json` (WebWorker lib), NOT by `tsconfig.json`
 * (DOM lib). The two carry mutually incompatible ambient globals, which is why
 * this file is excluded from the app's own tsconfig.
 */
/// <reference lib="webworker" />

/**
 * Injected by `tools/build-sw.mjs`. `declare` emits nothing, so the generated
 * file has exactly one definition of each.
 */
declare const __TRAYCER_SW_BUILD_ID__: string;
declare const __TRAYCER_SW_PRECACHE__: readonly string[];

/**
 * The service-worker global scope, bound to `self` by the generated header.
 *
 * `self` cannot simply be used: lib.webworker types it `WorkerGlobalScope &
 * typeof globalThis`, which covers dedicated workers too and therefore carries
 * neither `skipWaiting` nor a `FetchEvent`-shaped `addEventListener`. The usual
 * fix is `self as unknown as ServiceWorkerGlobalScope`; that is a double
 * assertion, which this package's lint rules ban outright and for good reason -
 * it is the construct that lets a wrong type through silently. Re-declaring
 * `self` is a duplicate identifier in a script.
 *
 * So the binding is one line of plain JS in `build-sw.mjs`'s header, declared
 * here with the type it actually has. The generated artifact is what the test
 * evaluates, so that line is exercised rather than asserted.
 */
declare const sw: ServiceWorkerGlobalScope;

const CACHE_PREFIX = "traycer-next-";
const CACHE_NAME = `${CACHE_PREFIX}${__TRAYCER_SW_BUILD_ID__}`;

/**
 * The precached paths, as a set, for the fetch handler's membership test.
 * These are origin-absolute pathnames (`/next/assets/index-x.js`).
 */
const PRECACHED = new Set<string>(__TRAYCER_SW_PRECACHE__);

/**
 * The app shell - the document every route boots from. gui-app routes on the
 * URL HASH at this deployment, so every in-app route is `/next/#/...` and the
 * PATH is always this one file. That is what makes a single-document shell
 * sufficient here, and it is worth knowing it is load-bearing: were the router
 * ever moved to history mode, a navigation to `/next/epics` would miss.
 */
const SHELL_URL = __TRAYCER_SW_PRECACHE__.find((url) => url.endsWith(".html"));

sw.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // `addAll` is atomic: one 404 rejects the lot and the worker never
      // installs. That is the behaviour we want - a half-precached shell is an
      // app that boots offline into a broken state, which is worse than an app
      // that says it is offline.
      await cache.addAll([...PRECACHED]);
    })(),
  );
  // Deliberately NO `skipWaiting()` here. A new worker installs and WAITS; the
  // page's update banner is what activates it, on a tap. Self-activating would
  // swap the assets under a running session - the tab keeps its already-loaded
  // JS but every subsequent lazy chunk comes from a different build.
});

sw.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter(
            (name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME,
          )
          .map((name) => caches.delete(name)),
      );
    })(),
  );
  // Deliberately NO `clients.claim()`, and this is a bug that was already paid
  // for once. Under a waiting-worker model, claiming buys nothing: the only
  // path a new version takes control is the banner's skipWaiting -> reload,
  // and the reload's own navigation controls the page naturally. What
  // `claim()` DID do was fire a spurious `controllerchange` on the very first
  // install - no previous worker existed to update from - which the old
  // client's unconditional `controllerchange` -> `location.reload()` turned
  // into one pointless reload for every user on first install.
});

const NOTIFICATION_CLICK = "traycer:notification-click";
const NOTIFICATION_CLIENT_READY = "traycer:notification-client-ready";
const NOTIFICATION_CLICK_ACK = "traycer:notification-click-ack";

sw.addEventListener("message", (event) => {
  const data = event.data as { readonly type?: string } | undefined;
  if (data?.type === "SKIP_WAITING") void sw.skipWaiting();
  if (data?.type === NOTIFICATION_CLIENT_READY) {
    // A page has just mounted its click listener. Hand it anything still
    // unacknowledged - this is what makes a tap survive a cold open. Delivered
    // to the announcing page alone, via `event.source`, rather than broadcast:
    // a second open tab would otherwise route the same click and navigate
    // itself somewhere the user never asked it to go.
    if (event.source !== null) flushPendingClicksTo(event.source);
  }
  if (data?.type === NOTIFICATION_CLICK_ACK) {
    const id = (event.data as { readonly id?: unknown }).id;
    if (typeof id === "string") acknowledgeClick(id);
  }
});

/**
 * Notifications: display and click routing.
 *
 * THE CLICK PAYLOAD IS NEVER PARSED HERE, and that is the design rather than a
 * shortcut. gui-app's `NotificationFocusBridge` already resolves a payload to a
 * destination - the epic's live tab, a closed chat tile to reopen, an origin
 * host that may no longer be the active one. None of that is expressible as a
 * URL, so a worker that built one would be reimplementing a router it cannot
 * see. The payload goes out through `INotificationHost.show()` and comes back
 * through `onClick()` byte-identical; `web-notification-host.ts` says the same
 * from the other side.
 *
 * The cold-open path therefore opens `registration.scope` - the app's own base
 * URL, no route invented - and delivers the payload by message once the page
 * says its listener is mounted.
 *
 * The three message-type constants are declared beside the `message` handler
 * that reads them, above.
 */

/**
 * Clicks awaiting an ack from a page.
 *
 * REMOVED ON ACK, NOT ON SEND. A `postMessage` to a window that has not yet
 * mounted its listener is dropped with no error anywhere - which is precisely
 * the cold-open case, since the window in question was opened microseconds
 * earlier by this handler. Clearing on send would lose exactly the taps this
 * feature exists to deliver.
 *
 * Worker memory is not durable: the browser may terminate an idle worker and
 * this queue dies with it. `notificationclick` therefore holds the worker alive
 * with `waitUntil` until the queue drains or the wait times out, which covers
 * the boot it just triggered. A tap that outlives that is lost, and the honest
 * consequence is that the app opens on its normal landing view.
 */
const pendingClicks: Array<{ id: string; payload: unknown }> = [];

/** Ids are per-click and only ever compared for equality, so a counter is enough - and, unlike a random id, it makes a test's expectations legible. */
let nextClickId = 0;

/** How long `notificationclick` keeps the worker alive waiting for a cold-opened page to boot and acknowledge. */
const CLICK_DELIVERY_TIMEOUT_MS = 10_000;
const CLICK_DELIVERY_POLL_MS = 100;

function acknowledgeClick(id: string): void {
  const index = pendingClicks.findIndex((entry) => entry.id === id);
  if (index !== -1) pendingClicks.splice(index, 1);
}

/**
 * Sends every unacknowledged click to ONE recipient.
 *
 * Targeted rather than broadcast. Two tabs are an ordinary state - the app is a
 * web page - and handing the same click to both makes both navigate, so the
 * background one silently jumps to a chat the user opened in the foreground.
 * The recipient is either the window this handler just focused or opened, or the
 * page that announced its own listener.
 */
function flushPendingClicksTo(target: {
  postMessage(message: unknown): void;
}): void {
  for (const entry of pendingClicks) {
    target.postMessage({
      type: NOTIFICATION_CLICK,
      id: entry.id,
      payload: entry.payload,
    });
  }
}

sw.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const payload: unknown = event.notification.data;
  const id = `click-${(nextClickId += 1)}`;
  pendingClicks.push({ id, payload });

  event.waitUntil(
    (async () => {
      const windows = await sw.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      // Prefer the window the user is actually looking at. `matchAll` order is
      // unspecified, so taking `[0]` can focus and message a lingering
      // background tab while the visible one sits there - a real bug the
      // retired worker also carried a guard against.
      const existing = windows.find((client) => client.focused) ?? windows[0];
      let target: WindowClient | null;
      if (existing === undefined) {
        // `registration.scope` is the deployment base (`/next/`), which is both
        // the correct URL and the only one this worker can know without
        // assuming a route shape.
        target = await sw.clients.openWindow(sw.registration.scope);
      } else {
        target = await existing.focus();
      }
      // `openWindow` is specified to resolve `null` when it cannot hand back a
      // handle. The click stays queued rather than being dropped: the page it
      // opened will announce itself, and that path does not need this handle.
      if (target === null) return;
      await waitForAck(id, target);
    })(),
  );
});

/**
 * Resolves when `id` has been acknowledged, or on timeout.
 *
 * Polling rather than a stored resolver because the ack arrives in a SEPARATE
 * event handler, and a promise captured across two service-worker events is
 * exactly the reference the runtime is entitled to discard when it decides the
 * worker is idle. Re-flushing on each tick also covers the page that mounts its
 * listener after the first send but before it thinks to announce itself.
 */
async function waitForAck(id: string, target: WindowClient): Promise<void> {
  const deadline = Date.now() + CLICK_DELIVERY_TIMEOUT_MS;
  for (;;) {
    if (!pendingClicks.some((entry) => entry.id === id)) return;
    flushPendingClicksTo(target);
    if (Date.now() >= deadline) return;
    await new Promise((resolve) => setTimeout(resolve, CLICK_DELIVERY_POLL_MS));
  }
}

/**
 * Background delivery. The payload shape is the same one
 * `INotificationHost.show()` receives, so a push and a foreground notification
 * produce an identical notification with identical click behaviour - one code
 * path from tap to route, rather than two that drift.
 *
 * A malformed push shows nothing rather than throwing. The browser may then
 * substitute its own "this site was updated in the background" notice, which is
 * the platform being honest about a `userVisibleOnly` subscription that
 * displayed nothing; inventing a placeholder to dodge it would hide a broken
 * sender.
 */
sw.addEventListener("push", (event) => {
  const parsed = parsePush(event.data);
  if (parsed === null) return;
  event.waitUntil(
    sw.registration.showNotification(parsed.title, {
      body: parsed.body,
      data: parsed.payload,
      tag: parsed.replaceKey ?? undefined,
    }),
  );
});

interface ParsedPush {
  readonly title: string;
  readonly body: string;
  readonly payload: unknown;
  readonly replaceKey: string | null;
}

function parsePush(data: PushMessageData | null): ParsedPush | null {
  if (data === null) return null;
  let parsed: unknown;
  try {
    parsed = data.json();
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object") return null;
  const record: Record<string, unknown> = { ...parsed };
  if (typeof record.title !== "string" || typeof record.body !== "string") {
    return null;
  }
  return {
    title: record.title,
    body: record.body,
    // Passed through unvalidated on purpose: see this section's docblock. A
    // sender that gets it wrong produces an unroutable click, which upstream
    // handles by opening the notification center - a visible, recoverable
    // outcome. Validating it here would produce a notification that is silently
    // never shown, which is neither.
    payload: record.payload ?? null,
    replaceKey:
      typeof record.replaceKey === "string" ? record.replaceKey : null,
  };
}

sw.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  // NOT OPTIONAL, and not a same-origin nicety. A controlled page's requests
  // ALL pass through here, including the ones outside this worker's scope -
  // `/authn/api/v3/...`, the `/rpc` and `/stream` upgrades, every host call.
  // Scope limits which pages a worker controls, never which of their requests
  // it sees. Serving any of those from a cache would hand a returning user a
  // stale token response; so this worker answers for precached shell assets
  // and returns - not responds - for everything else, leaving the browser's
  // own network path untouched.
  if (url.origin !== sw.location.origin) return;

  if (request.mode === "navigate") {
    if (SHELL_URL === undefined) return;
    event.respondWith(serveShell(request, SHELL_URL));
    return;
  }

  if (!PRECACHED.has(url.pathname)) return;
  event.respondWith(serveAsset(request, url.pathname));
});

/**
 * Navigations get the precached document, falling back to the network.
 *
 * Cache-first for the shell is what makes the app open with no network at all.
 * It does not pin the user to an old build: the browser re-fetches this
 * worker's own script on navigation, and `tools/build-sw.mjs` derives the
 * build id from the asset list, so a deploy changes these bytes, the worker
 * updates, and the banner offers the new version.
 */
async function serveShell(
  request: Request,
  shellUrl: string,
): Promise<Response> {
  const cached = await caches.match(shellUrl);
  if (cached !== undefined) return cached;
  return fetch(request);
}

/** Precached assets are content-hashed, so a hit is always the right bytes. */
async function serveAsset(
  request: Request,
  pathname: string,
): Promise<Response> {
  const cached = await caches.match(pathname);
  if (cached !== undefined) return cached;
  return fetch(request);
}
