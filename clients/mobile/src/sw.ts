/**
 * Sprint 5 (B/C/D): custom service worker (`injectManifest` strategy — a
 * `generateSW`-produced opaque SW couldn't host the `notificationclick`
 * handler §C needs, so precaching and the click handler share this one file).
 *
 * Push sprint: adds the `push` listener (background delivery) and reworks
 * `notificationclick` — background push inverts S5(C)'s "app already open"
 * assumption (app-closed is the entire point of background push), so the
 * cold-open path now carries the deep-link target instead of discarding it,
 * and the warm path is hardened against two real bugs an arbitrary-window
 * pick and a silent-drop boot race (see the push contract's "Warm path"
 * section for the full writeup).
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

/** The push payload the mobile-push-service sends — see its `push-payload.ts`. */
interface ParsedPushPayload {
  readonly title: string;
  readonly body: string;
  readonly data: NotificationTarget;
}

/** `epicId`/`chatId` both present for a per-entry push; both absent for a coalesced summary push (no single target). */
interface NotificationTarget {
  readonly epicId?: string;
  readonly chatId?: string;
}

self.addEventListener("push", (event: PushEvent) => {
  const payload = parsePushPayload(event.data);
  if (payload === null) return;
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      data: payload.data,
      tag:
        payload.data.epicId !== undefined && payload.data.chatId !== undefined
          ? `entry:${payload.data.epicId}:${payload.data.chatId}`
          : "summary",
    }),
  );
});

/** `null` on any malformed/unparseable payload — a bad push degrades to "no notification shown", never a crash. */
function parsePushPayload(data: PushMessageData | null): ParsedPushPayload | null {
  if (data === null) return null;
  let parsed: unknown;
  try {
    parsed = data.json();
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.title !== "string" || typeof obj.body !== "string") return null;
  return { title: obj.title, body: obj.body, data: parseNotificationTarget(obj.data) };
}

function parseNotificationTarget(value: unknown): NotificationTarget {
  if (value === null || typeof value !== "object") return {};
  const obj = value as Record<string, unknown>;
  const epicId = typeof obj.epicId === "string" ? obj.epicId : undefined;
  const chatId = typeof obj.chatId === "string" ? obj.chatId : undefined;
  return epicId !== undefined && chatId !== undefined ? { epicId, chatId } : {};
}

/** `/?epicId=…&chatId=…` when the target is known; plain `/` (Fleet) otherwise — the cold-open boot parser (`AppShell`) reads these. */
function deepLinkUrl(target: NotificationTarget): string {
  if (target.epicId === undefined || target.chatId === undefined) return "/";
  const params = new URLSearchParams({ epicId: target.epicId, chatId: target.chatId });
  return `/?${params.toString()}`;
}

/** Bounded wait for `AppShell`'s message-listener ack (see `app-shell.tsx`). `false` on timeout — including the case where the listener never mounts, e.g. mid-boot. */
const POST_MESSAGE_ACK_TIMEOUT_MS = 1_000;

function postOpenChatWithAck(
  client: WindowClient,
  epicId: string,
  chatId: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(false);
    }, POST_MESSAGE_ACK_TIMEOUT_MS);
    channel.port1.onmessage = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(true);
    };
    client.postMessage({ type: "open-chat", epicId, chatId }, [channel.port2]);
  });
}

self.addEventListener("notificationclick", (event: NotificationEvent) => {
  event.notification.close();
  const target = (event.notification.data as NotificationTarget | undefined) ?? {};

  event.waitUntil(
    (async () => {
      const clientsList = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      // Prefer the actually-focused window over an arbitrary `matchAll` entry
      // (a lingering background tab, or `includeUncontrolled` widening the
      // set further) — focusing/messaging the wrong window is a real bug, not
      // a hypothetical.
      const existing = clientsList.find((c) => c.focused) ?? clientsList[0];
      if (existing !== undefined) {
        await existing.focus();
        if (target.epicId !== undefined && target.chatId !== undefined) {
          const acked = await postOpenChatWithAck(existing, target.epicId, target.chatId);
          if (!acked) {
            // The matched client's message listener never mounted in time
            // (a narrow boot race) — fall back to a real navigation using the
            // SAME URL + boot-time parser the cold-open path already uses,
            // rather than leaving the tap silently dropped.
            await existing.navigate(deepLinkUrl(target));
          }
        }
        return;
      }
      await self.clients.openWindow(deepLinkUrl(target));
    })(),
  );
});
