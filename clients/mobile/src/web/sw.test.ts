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
import {
  NOTIFICATION_CLICK_ACK_MESSAGE,
  NOTIFICATION_CLICK_MESSAGE,
  NOTIFICATION_CLIENT_READY_MESSAGE,
} from "./web-notification-host";

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
  notificationclick?: (event: unknown) => void;
  push?: (event: unknown) => void;
}

const SCOPE = `${ORIGIN}/next/`;

interface FakeClient {
  readonly id: string;
  focused: boolean;
  focusCalls: number;
  readonly messages: unknown[];
  postMessage(message: unknown): void;
  focus(): Promise<FakeClient>;
}

function fakeClient(id: string, focused: boolean): FakeClient {
  const client: FakeClient = {
    id,
    focused,
    focusCalls: 0,
    messages: [] as unknown[],
    postMessage(message: unknown) {
      client.messages.push(message);
    },
    async focus() {
      client.focusCalls += 1;
      client.focused = true;
      return client;
    },
  };
  return client;
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

async function loadWorker(precache: string[], windows: FakeClient[]) {
  const { text, buildId } = await buildServiceWorkerText(MOBILE_ROOT, precache);

  const listeners: Listeners = {};
  const skipWaiting = vi.fn();
  const shown: Array<{ title: string; options: Record<string, unknown> }> = [];
  const openWindow = vi.fn(async (url: string) => {
    const opened = fakeClient(`opened:${url}`, false);
    windows.push(opened);
    return opened;
  });
  const self = {
    location: { origin: ORIGIN },
    skipWaiting,
    registration: {
      scope: SCOPE,
      async showNotification(title: string, options: Record<string, unknown>) {
        shown.push({ title, options });
      },
    },
    clients: {
      async matchAll() {
        return windows;
      },
      openWindow,
    },
    addEventListener(type: keyof Listeners, fn: (event: unknown) => void) {
      listeners[type] = fn;
    },
  };
  const caches = fakeCaches();
  const fetchFn = vi.fn(async (request: unknown) => ({ fromNetwork: request }));

  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  new Function("self", "caches", "fetch", text)(self, caches, fetchFn);

  return {
    listeners,
    caches,
    skipWaiting,
    fetch: fetchFn,
    buildId,
    text,
    shown,
    windows,
    openWindow,
  };
}

/** Fires `notificationclick` and returns the promise the handler passed to `waitUntil`. */
function runNotificationClick(
  listeners: Listeners,
  data: unknown,
): { settled: Promise<unknown>; closed: () => boolean } {
  let closed = false;
  const pending: Promise<unknown>[] = [];
  listeners.notificationclick?.({
    notification: {
      data,
      close: () => {
        closed = true;
      },
    },
    waitUntil: (p: Promise<unknown>) => pending.push(p),
  });
  return {
    settled: Promise.all(pending),
    closed: () => closed,
  };
}

/** Lets the handler's own awaits run without waiting out the redelivery poll. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
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
      const { listeners, caches, buildId } = await loadWorker(PRECACHE, []);
      await runInstall(listeners);

      const bucket = caches.store.get(`traycer-next-${buildId}`);
      expect([...(bucket?.keys() ?? [])]).toEqual(PRECACHE_SORTED);
      // One bucket, so nothing precached itself under a second name.
      expect([...caches.store.keys()]).toEqual([`traycer-next-${buildId}`]);
    });

    it("does not skipWaiting - a new version waits for the user's tap", async () => {
      const { listeners, skipWaiting } = await loadWorker(PRECACHE, []);
      await runInstall(listeners);
      expect(skipWaiting).not.toHaveBeenCalled();
    });
  });

  describe("activate", () => {
    it("deletes older Traycer caches and leaves everything else alone", async () => {
      const { listeners, caches, buildId } = await loadWorker(PRECACHE, []);
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
      const { listeners } = await loadWorker(PRECACHE, []);
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
      const { listeners } = await loadWorker(PRECACHE, []);
      await runInstall(listeners);

      const response = await runFetch(listeners, {
        url: `${ORIGIN}/next/#/epics/123`,
        mode: "navigate",
      });

      expect(response).toEqual({ cached: "/next/index.html" });
    });

    it("serves a precached asset from the cache", async () => {
      const { listeners, fetch } = await loadWorker(PRECACHE, []);
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
      const { listeners } = await loadWorker(PRECACHE, []);
      await runInstall(listeners);

      expect(
        await runFetch(listeners, { url: `${ORIGIN}/authn/api/v3/user` }),
      ).toBeNull();
      expect(await runFetch(listeners, { url: `${ORIGIN}/rpc` })).toBeNull();
    });

    it("does not intercept a lazily-loaded chunk that was never precached", async () => {
      // The mermaid/katex/cytoscape family, deliberately left out of the
      // precache so installing the worker does not pull several MB nobody
      // asked for. They must still LOAD - straight off the network, with the
      // worker declining to answer.
      const { listeners } = await loadWorker(PRECACHE, []);
      await runInstall(listeners);

      expect(
        await runFetch(listeners, {
          url: `${ORIGIN}/next/assets/mermaid-xyz.js`,
        }),
      ).toBeNull();
    });

    it("does not intercept cross-origin requests", async () => {
      const { listeners } = await loadWorker(PRECACHE, []);
      await runInstall(listeners);

      expect(
        await runFetch(listeners, { url: "https://relay.traycer.ai/attach" }),
      ).toBeNull();
    });

    it("does not intercept non-GET requests", async () => {
      const { listeners } = await loadWorker(PRECACHE, []);
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
      const { listeners, caches, fetch } = await loadWorker(PRECACHE, []);
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
      const { listeners, skipWaiting } = await loadWorker(PRECACHE, []);
      listeners.message?.({ data: { type: "SKIP_WAITING" } });
      expect(skipWaiting).toHaveBeenCalledTimes(1);
    });

    it("ignores any other message", async () => {
      const { listeners, skipWaiting } = await loadWorker(PRECACHE, []);
      listeners.message?.({ data: { type: "something-else" } });
      listeners.message?.({ data: undefined });
      listeners.message?.({});
      expect(skipWaiting).not.toHaveBeenCalled();
    });
  });

  describe("notificationclick", () => {
    const PAYLOAD = {
      kind: "notificationActivation",
      version: 1,
      route: { kind: "chat", epicId: "epic-1", chatId: "chat-9" },
      feed: { source: "host", id: "feed-3" },
      originHostId: "host-7",
    };

    it("delivers the payload to the FOCUSED window, not an arbitrary one", async () => {
      // `matchAll` order is unspecified and `includeUncontrolled` widens the
      // set further, so taking `[0]` can focus and message a lingering
      // background tab while the visible one sits there.
      const background = fakeClient("background", false);
      const visible = fakeClient("visible", true);
      const { listeners } = await loadWorker(PRECACHE, [background, visible]);

      const click = runNotificationClick(listeners, PAYLOAD);
      await tick();

      expect(visible.messages).toEqual([
        { type: NOTIFICATION_CLICK_MESSAGE, id: "click-1", payload: PAYLOAD },
      ]);
      // The negative half, and the one that does the work. Asserting only that
      // the visible tab got the message passes just as happily when BOTH did -
      // which is what an earlier version of this worker actually did, and what
      // let the arbitrary-window mutation survive against an identical
      // assertion. A background tab that receives the click routes it, and the
      // user's other tab jumps to a chat they opened somewhere else.
      expect(background.messages).toEqual([]);
      expect(background.focusCalls).toBe(0);
      expect(visible.focusCalls).toBe(1);
      expect(click.closed()).toBe(true);
      void click.settled;
    });

    it("passes the payload through byte-identically", async () => {
      // The worker parses nothing: gui-app's focus bridge is what resolves a
      // payload to a destination. A whole-object comparison rather than a field
      // sweep - a field sweep only covers the fields somebody thought of, and a
      // dropped `originHostId` is how a click routes against the wrong host.
      const visible = fakeClient("visible", true);
      const { listeners } = await loadWorker(PRECACHE, [visible]);

      const click = runNotificationClick(listeners, PAYLOAD);
      await tick();

      expect((visible.messages[0] as { payload: unknown }).payload).toEqual(
        PAYLOAD,
      );
      void click.settled;
    });

    it("OPENS the app at its own scope when no window is open", async () => {
      // The cold-open path, and the reason no URL is invented: the worker opens
      // `registration.scope` and hands the payload over by message. gui-app
      // routes on the hash here and a chat is not addressable as a route at
      // all, so a constructed deep link could only ever be wrong.
      const { listeners, openWindow } = await loadWorker(PRECACHE, []);

      const click = runNotificationClick(listeners, PAYLOAD);
      await tick();

      expect(openWindow).toHaveBeenCalledWith(SCOPE);
      void click.settled;
    });

    it("REDELIVERS to a window that mounts its listener after the open", async () => {
      // The defect this whole ack protocol exists for. A `postMessage` to a
      // just-opened window whose listener has not mounted is dropped with no
      // error anywhere - so the first send lands nowhere and the tap would be
      // lost. The page announces itself when its listener mounts and the worker
      // flushes what it still holds.
      const { listeners, windows } = await loadWorker(PRECACHE, []);

      const click = runNotificationClick(listeners, PAYLOAD);
      await tick();
      const opened = windows[0];
      if (opened === undefined) throw new Error("no window was opened");
      // Whatever the first flush sent, the page missed - it had no listener.
      opened.messages.length = 0;

      listeners.message?.({
        data: { type: NOTIFICATION_CLIENT_READY_MESSAGE },
        source: opened,
        waitUntil: () => undefined,
      });
      await tick();

      expect(opened.messages).toEqual([
        { type: NOTIFICATION_CLICK_MESSAGE, id: "click-1", payload: PAYLOAD },
      ]);
      void click.settled;
    });

    it("STOPS redelivering once the page acknowledges", async () => {
      const visible = fakeClient("visible", true);
      const { listeners } = await loadWorker(PRECACHE, [visible]);

      const click = runNotificationClick(listeners, PAYLOAD);
      await tick();
      listeners.message?.({
        data: { type: NOTIFICATION_CLICK_ACK_MESSAGE, id: "click-1" },
        waitUntil: () => undefined,
      });

      // The handler's `waitUntil` settling is itself the assertion: it polls
      // until the entry is gone, so a promise that resolves means the ack was
      // honoured. Without one it would sit for the full delivery timeout.
      await click.settled;

      visible.messages.length = 0;
      listeners.message?.({
        data: { type: NOTIFICATION_CLIENT_READY_MESSAGE },
        source: visible,
        waitUntil: () => undefined,
      });
      await tick();
      expect(visible.messages).toEqual([]);
    });

    it("ignores an ack for an id it is not holding", async () => {
      const visible = fakeClient("visible", true);
      const { listeners } = await loadWorker(PRECACHE, [visible]);
      const click = runNotificationClick(listeners, PAYLOAD);
      await tick();

      expect(() =>
        listeners.message?.({
          data: { type: NOTIFICATION_CLICK_ACK_MESSAGE, id: "click-999" },
          waitUntil: () => undefined,
        }),
      ).not.toThrow();

      listeners.message?.({
        data: { type: NOTIFICATION_CLICK_ACK_MESSAGE, id: "click-1" },
        waitUntil: () => undefined,
      });
      await click.settled;
    });
  });

  describe("push", () => {
    it("shows a notification carrying the sender's payload", async () => {
      const { listeners, shown } = await loadWorker(PRECACHE, []);
      const payload = { kind: "notificationActivation", version: 1 };

      const pending: Promise<unknown>[] = [];
      listeners.push?.({
        data: {
          json: () => ({
            title: "Agent blocked",
            body: "Needs approval",
            payload,
            replaceKey: "epic-1",
          }),
        },
        waitUntil: (p: Promise<unknown>) => pending.push(p),
      });
      await Promise.all(pending);

      expect(shown).toEqual([
        {
          title: "Agent blocked",
          options: { body: "Needs approval", data: payload, tag: "epic-1" },
        },
      ]);
    });

    it("produces the SAME notification shape a foreground show() does", async () => {
      // One code path from tap to route. If a pushed notification carried its
      // target somewhere other than `data`, the click handler would find
      // nothing there and every background tap would land on the app's landing
      // view - while foreground notifications kept working, which is the
      // hardest version of this bug to notice.
      const { listeners, shown } = await loadWorker(PRECACHE, []);
      const pending: Promise<unknown>[] = [];
      listeners.push?.({
        data: { json: () => ({ title: "t", body: "b", payload: { a: 1 } }) },
        waitUntil: (p: Promise<unknown>) => pending.push(p),
      });
      await Promise.all(pending);

      expect(shown[0]?.options).toEqual({
        body: "b",
        data: { a: 1 },
        tag: undefined,
      });
    });

    it("shows NOTHING for a malformed push rather than throwing", async () => {
      const { listeners, shown } = await loadWorker(PRECACHE, []);
      const fire = (data: unknown): void => {
        listeners.push?.({ data, waitUntil: () => undefined });
      };

      fire(null);
      fire({
        json: () => {
          throw new Error("not json");
        },
      });
      fire({ json: () => "a string" });
      fire({ json: () => ({ body: "no title" }) });
      fire({ json: () => ({ title: "no body" }) });

      expect(shown).toEqual([]);
    });

    it("defaults a missing payload to null, the value upstream reads as unroutable", async () => {
      const { listeners, shown } = await loadWorker(PRECACHE, []);
      const pending: Promise<unknown>[] = [];
      listeners.push?.({
        data: { json: () => ({ title: "t", body: "b" }) },
        waitUntil: (p: Promise<unknown>) => pending.push(p),
      });
      await Promise.all(pending);

      expect(shown[0]?.options.data).toBeNull();
    });
  });

  describe("the message-type constants", () => {
    it("match the page-side module EXACTLY", async () => {
      // The worker is a classic script and cannot import them, so the two
      // spellings are duplicated. A silent disagreement produces a notification
      // that shows, taps, and does nothing - a failure with no error to read
      // anywhere. Asserting against the GENERATED text is what makes the
      // duplication checked rather than trusted.
      const { text } = await loadWorker(PRECACHE, []);

      expect(text).toContain(JSON.stringify(NOTIFICATION_CLICK_MESSAGE));
      expect(text).toContain(JSON.stringify(NOTIFICATION_CLIENT_READY_MESSAGE));
      expect(text).toContain(JSON.stringify(NOTIFICATION_CLICK_ACK_MESSAGE));
    });
  });

  describe("the build id", () => {
    it("changes when the precached assets change", async () => {
      // THE UPDATE MECHANISM, and it is the whole reason the id is derived
      // from content. A browser installs a new worker only if the script's
      // BYTES differ; if a deploy left these identical, users would keep the
      // old shell forever and the banner would never appear.
      const a = await loadWorker(PRECACHE, []);
      const b = await loadWorker(
        [...PRECACHE.slice(0, 1), "/next/assets/index-DEF.js"],
        [],
      );
      expect(b.buildId).not.toBe(a.buildId);
      expect(b.text).not.toBe(a.text);
    });

    it("is stable for an identical build", async () => {
      // The other half, and the one a timestamp would fail: a rebuild that
      // changed nothing must not prompt every user to refresh.
      const a = await loadWorker(PRECACHE, []);
      const b = await loadWorker([...PRECACHE], []);
      expect(b.buildId).toBe(a.buildId);
      expect(b.text).toBe(a.text);
    });

    it("does not depend on the order the URLs were collected in", async () => {
      // The TEXT, not just the id. Sorting only the hash input would leave a
      // stable build id inside a file whose bytes moved, and the browser
      // compares the bytes - so a reordering that changed nothing would still
      // prompt every user to refresh.
      const a = await loadWorker(PRECACHE, []);
      const b = await loadWorker([...PRECACHE].reverse(), []);
      expect(b.buildId).toBe(a.buildId);
      expect(b.text).toBe(a.text);
    });
  });
});
