/**
 * Drives the GENERATED `sw.js`, not `sw.ts`.
 *
 * `buildServiceWorkerText` is the same function the build calls, so what runs
 * here is byte-for-byte the artifact that ships - including the injected
 * `__TRAYCER_SW_PRECACHE__`/`__TRAYCER_SW_BUILD_ID__` constants, which are
 * themselves a place a defect can live and which a test against the source
 * module could not reach at all.
 *
 * The worker is a classic script, so it is evaluated with its globals supplied
 * as parameters rather than imported. That is also the reason the fakes below
 * are hand-written: there is no service-worker environment to borrow.
 */
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildServiceWorkerText } from "../../tools/build-sw.mjs";

const MOBILE_ROOT = resolve(__dirname, "..", "..");
const ORIGIN = "https://host.example";

const PRECACHE = [
  "/next/index.html",
  "/next/assets/index-abc.js",
  "/next/assets/index-abc.css",
  "/next/manifest.webmanifest",
];

/** What the generator injects: the same set, sorted. */
const PRECACHE_SORTED = [...PRECACHE].sort();

interface Listeners {
  install?: (event: unknown) => void;
  activate?: (event: unknown) => void;
  fetch?: (event: unknown) => void;
  message?: (event: unknown) => void;
}

/** A minimal `CacheStorage`: named buckets of URL -> marker Response. */
function fakeCaches() {
  const store = new Map<string, Map<string, unknown>>();
  return {
    store,
    async open(name: string) {
      const bucket = store.get(name) ?? new Map<string, unknown>();
      store.set(name, bucket);
      return {
        async addAll(urls: string[]) {
          for (const url of urls) bucket.set(url, { cached: url });
        },
      };
    },
    async keys() {
      return [...store.keys()];
    },
    async delete(name: string) {
      return store.delete(name);
    },
    async match(url: string) {
      for (const bucket of store.values()) {
        const hit = bucket.get(url);
        if (hit !== undefined) return hit;
      }
      return undefined;
    },
  };
}

async function loadWorker(precache: string[]) {
  const { text, buildId } = await buildServiceWorkerText(MOBILE_ROOT, precache);

  const listeners: Listeners = {};
  const skipWaiting = vi.fn();
  const self = {
    location: { origin: ORIGIN },
    skipWaiting,
    addEventListener(type: keyof Listeners, fn: (event: unknown) => void) {
      listeners[type] = fn;
    },
  };
  const caches = fakeCaches();
  const fetchFn = vi.fn(async (request: unknown) => ({ fromNetwork: request }));

  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  new Function("self", "caches", "fetch", text)(self, caches, fetchFn);

  return { listeners, caches, skipWaiting, fetch: fetchFn, buildId, text };
}

/** Runs the install handler and awaits whatever it passed to `waitUntil`. */
async function runInstall(listeners: Listeners): Promise<void> {
  const pending: Promise<unknown>[] = [];
  listeners.install?.({ waitUntil: (p: Promise<unknown>) => pending.push(p) });
  await Promise.all(pending);
}

async function runActivate(listeners: Listeners): Promise<void> {
  const pending: Promise<unknown>[] = [];
  listeners.activate?.({ waitUntil: (p: Promise<unknown>) => pending.push(p) });
  await Promise.all(pending);
}

/** `null` when the worker declined to intercept - the distinction under test. */
async function runFetch(
  listeners: Listeners,
  request: { url: string; method?: string; mode?: string },
): Promise<unknown> {
  const responded: Promise<unknown>[] = [];
  listeners.fetch?.({
    request: { method: "GET", mode: "no-cors", ...request },
    respondWith: (p: Promise<unknown>) => responded.push(p),
  });
  if (responded.length === 0) return null;
  return await responded[0];
}

describe("the generated service worker", () => {
  describe("install", () => {
    it("precaches exactly the injected list", async () => {
      const { listeners, caches, buildId } = await loadWorker(PRECACHE);
      await runInstall(listeners);

      const bucket = caches.store.get(`traycer-next-${buildId}`);
      expect([...(bucket?.keys() ?? [])]).toEqual(PRECACHE_SORTED);
      // One bucket, so nothing precached itself under a second name.
      expect([...caches.store.keys()]).toEqual([`traycer-next-${buildId}`]);
    });

    it("does not skipWaiting - a new version waits for the user's tap", async () => {
      const { listeners, skipWaiting } = await loadWorker(PRECACHE);
      await runInstall(listeners);
      expect(skipWaiting).not.toHaveBeenCalled();
    });
  });

  describe("activate", () => {
    it("deletes older Traycer caches and leaves everything else alone", async () => {
      const { listeners, caches, buildId } = await loadWorker(PRECACHE);
      await caches.open("traycer-next-oldbuild00");
      await caches.open("some-other-app-cache");
      await runInstall(listeners);

      await runActivate(listeners);

      expect([...caches.store.keys()].sort()).toEqual(
        ["some-other-app-cache", `traycer-next-${buildId}`].sort(),
      );
    });
  });

  describe("fetch", () => {
    it("SERVES the app shell for a navigation", async () => {
      const { listeners } = await loadWorker(PRECACHE);
      await runInstall(listeners);

      const response = await runFetch(listeners, {
        url: `${ORIGIN}/next/`,
        mode: "navigate",
      });

      expect(response).toEqual({ cached: "/next/index.html" });
    });

    it("serves a navigation to a hash route from the same one document", async () => {
      // gui-app routes on the hash at this deployment, so every in-app route
      // is a navigation to the SAME path. If the router were ever moved to
      // history mode this assertion still passes while the real app 404s
      // offline - which is why `sw.ts` says so at the SHELL_URL definition
      // rather than leaving it for a reader to infer.
      const { listeners } = await loadWorker(PRECACHE);
      await runInstall(listeners);

      const response = await runFetch(listeners, {
        url: `${ORIGIN}/next/#/epics/123`,
        mode: "navigate",
      });

      expect(response).toEqual({ cached: "/next/index.html" });
    });

    it("serves a precached asset from the cache", async () => {
      const { listeners, fetch } = await loadWorker(PRECACHE);
      await runInstall(listeners);

      const response = await runFetch(listeners, {
        url: `${ORIGIN}/next/assets/index-abc.js`,
      });

      expect(response).toEqual({ cached: "/next/assets/index-abc.js" });
      expect(fetch).not.toHaveBeenCalled();
    });

    it("DOES NOT TOUCH the auth endpoints", async () => {
      // The one that matters most, and the reason the origin/membership guards
      // are not decoration. A controlled page's requests ALL pass through the
      // fetch handler, including ones outside the worker's `/next/` scope:
      // scope decides which PAGES a worker controls, never which of their
      // REQUESTS it sees. A worker that answered here could hand a returning
      // user a cached token response.
      const { listeners } = await loadWorker(PRECACHE);
      await runInstall(listeners);

      expect(
        await runFetch(listeners, { url: `${ORIGIN}/authn/api/v3/user` }),
      ).toBeNull();
      expect(
        await runFetch(listeners, { url: `${ORIGIN}/rpc` }),
      ).toBeNull();
    });

    it("does not intercept a lazily-loaded chunk that was never precached", async () => {
      // The mermaid/katex/cytoscape family, deliberately left out of the
      // precache so installing the worker does not pull several MB nobody
      // asked for. They must still LOAD - straight off the network, with the
      // worker declining to answer.
      const { listeners } = await loadWorker(PRECACHE);
      await runInstall(listeners);

      expect(
        await runFetch(listeners, { url: `${ORIGIN}/next/assets/mermaid-xyz.js` }),
      ).toBeNull();
    });

    it("does not intercept cross-origin requests", async () => {
      const { listeners } = await loadWorker(PRECACHE);
      await runInstall(listeners);

      expect(
        await runFetch(listeners, { url: "https://relay.traycer.ai/attach" }),
      ).toBeNull();
    });

    it("does not intercept non-GET requests", async () => {
      const { listeners } = await loadWorker(PRECACHE);
      await runInstall(listeners);

      expect(
        await runFetch(listeners, {
          url: `${ORIGIN}/next/assets/index-abc.js`,
          method: "POST",
        }),
      ).toBeNull();
    });

    it("falls back to the network when the cache has been evicted", async () => {
      // Browsers evict Cache Storage under pressure without telling the
      // worker. A cache-first read that assumed a hit would serve `undefined`
      // as a Response and blank the app.
      const { listeners, caches, fetch } = await loadWorker(PRECACHE);
      await runInstall(listeners);
      caches.store.clear();

      const response = await runFetch(listeners, {
        url: `${ORIGIN}/next/assets/index-abc.js`,
      });

      expect(fetch).toHaveBeenCalledTimes(1);
      expect(response).toEqual({ fromNetwork: expect.anything() });
    });
  });

  describe("message", () => {
    it("skips waiting when the update banner asks it to", async () => {
      const { listeners, skipWaiting } = await loadWorker(PRECACHE);
      listeners.message?.({ data: { type: "SKIP_WAITING" } });
      expect(skipWaiting).toHaveBeenCalledTimes(1);
    });

    it("ignores any other message", async () => {
      const { listeners, skipWaiting } = await loadWorker(PRECACHE);
      listeners.message?.({ data: { type: "something-else" } });
      listeners.message?.({ data: undefined });
      listeners.message?.({});
      expect(skipWaiting).not.toHaveBeenCalled();
    });
  });

  describe("the build id", () => {
    it("changes when the precached assets change", async () => {
      // THE UPDATE MECHANISM, and it is the whole reason the id is derived
      // from content. A browser installs a new worker only if the script's
      // BYTES differ; if a deploy left these identical, users would keep the
      // old shell forever and the banner would never appear.
      const a = await loadWorker(PRECACHE);
      const b = await loadWorker([...PRECACHE.slice(0, 1), "/next/assets/index-DEF.js"]);
      expect(b.buildId).not.toBe(a.buildId);
      expect(b.text).not.toBe(a.text);
    });

    it("is stable for an identical build", async () => {
      // The other half, and the one a timestamp would fail: a rebuild that
      // changed nothing must not prompt every user to refresh.
      const a = await loadWorker(PRECACHE);
      const b = await loadWorker([...PRECACHE]);
      expect(b.buildId).toBe(a.buildId);
      expect(b.text).toBe(a.text);
    });

    it("does not depend on the order the URLs were collected in", async () => {
      // The TEXT, not just the id. Sorting only the hash input would leave a
      // stable build id inside a file whose bytes moved, and the browser
      // compares the bytes - so a reordering that changed nothing would still
      // prompt every user to refresh.
      const a = await loadWorker(PRECACHE);
      const b = await loadWorker([...PRECACHE].reverse());
      expect(b.buildId).toBe(a.buildId);
      expect(b.text).toBe(a.text);
    });
  });
});
