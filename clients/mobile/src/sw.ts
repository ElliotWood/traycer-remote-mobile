/**
 * Sprint 5 (B/C/D): custom service worker (`injectManifest` strategy — a
 * `generateSW`-produced opaque SW couldn't host the `notificationclick`
 * handler §C needs, so precaching and the click handler share this one file).
 *
 * Type-checked separately via `tsconfig.sw.json` (WebWorker lib), NOT
 * `tsconfig.app.json` (DOM lib) — the two are mutually incompatible ambient
 * globals, which is why this file is excluded from the app tsconfig.
 */
/// <reference lib="webworker" />

import { precacheAndRoute } from "workbox-precaching";

declare const self: ServiceWorkerGlobalScope & {
  readonly __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

/**
 * S5 (B, M3): precache scope is deliberately the app shell only — see
 * vite.config.ts's `injectManifest.globPatterns` (index.html, the main JS
 * entry, the manifest, the icons). The lazy mermaid/katex/cytoscape-family
 * diagram chunks Sprint 1 kept off the initial route are NOT swept in by a
 * default "precache everything" glob; they stay runtime-fetch-on-demand.
 */
precacheAndRoute(self.__WB_MANIFEST);

/**
 * `registerType: "prompt"` (vite.config.ts) — this worker installs and waits;
 * it does NOT self-activate. The page's version-prompt banner posts this
 * message only after the user taps "tap to refresh".
 */
self.addEventListener("message", (event: ExtendableMessageEvent) => {
  const data = event.data as { readonly type?: string } | undefined;
  if (data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

// No `self.clients.claim()` on "activate" here — deliberately. Under
// `registerType: "prompt"`, taking control early buys nothing: the only
// path a NEW version ever takes control is the explicit skipWaiting →
// reload flow above, which controls the page naturally via the reload's
// own fresh navigation. `clients.claim()`'s actual effect was firing a
// spurious `controllerchange` on the very FIRST install (no previous SW
// existed to "update" from) — `version-prompt-banner.tsx`'s unconditional
// `controllerchange` → `window.location.reload()` then reloaded the page
// once for every user on first install, with nothing to show for it.
/**
 * S5 (C, P1): a blocked-chat notification's click focuses an existing app
 * client and hands it `{epicId, chatId}` so `AppShell`'s message listener
 * (app-shell.tsx) can navigate straight to that chat via the existing nav
 * reducer — no URL routing needed. If no client is currently open, this
 * degrades to just opening the app: a freshly-opened window has no listener
 * registered yet to catch a `postMessage`, so auto-navigating a cold open
 * isn't attempted (documented scope limit, not a bug — the live-verified case
 * is "app already open, notification arrives").
 */
self.addEventListener("notificationclick", (event: NotificationEvent) => {
  event.notification.close();
  const data = event.notification.data as
    | { readonly epicId?: string; readonly chatId?: string }
    | undefined;

  event.waitUntil(
    (async () => {
      const clientsList = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const existing = clientsList[0];
      if (existing !== undefined) {
        await existing.focus();
        if (data?.epicId !== undefined && data.chatId !== undefined) {
          existing.postMessage({
            type: "open-chat",
            epicId: data.epicId,
            chatId: data.chatId,
          });
        }
        return;
      }
      await self.clients.openWindow("/");
    })(),
  );
});
