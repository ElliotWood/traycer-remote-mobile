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
          .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
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

sw.addEventListener("message", (event) => {
  const data = event.data as { readonly type?: string } | undefined;
  if (data?.type === "SKIP_WAITING") void sw.skipWaiting();
});

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
async function serveShell(request: Request, shellUrl: string): Promise<Response> {
  const cached = await caches.match(shellUrl);
  if (cached !== undefined) return cached;
  return fetch(request);
}

/** Precached assets are content-hashed, so a hit is always the right bytes. */
async function serveAsset(request: Request, pathname: string): Promise<Response> {
  const cached = await caches.match(pathname);
  if (cached !== undefined) return cached;
  return fetch(request);
}
