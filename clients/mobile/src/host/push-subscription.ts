/**
 * Push sprint: `PushManager` subscribe/unsubscribe against the
 * mobile-push-service HTTP API. Mirrors `notifications.ts`'s style/guards —
 * best-effort, degrades honestly (never throws past the caller), and never
 * calls `Notification.requestPermission()` itself (that stays the alerts
 * button's job, gated behind an explicit tap).
 */
import { PUSH_BASE_URL } from "@/config";
import { getNotificationPermission } from "./notifications";

export type PushSubscribeOutcome =
  | { readonly kind: "subscribed" }
  | { readonly kind: "permission-denied" }
  | { readonly kind: "service-unreachable" }
  | { readonly kind: "unsupported" };

function pushSupported(): boolean {
  return (
    PUSH_BASE_URL !== null &&
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    typeof window !== "undefined" &&
    "PushManager" in window
  );
}

/**
 * Subscribes the current service-worker registration to push and registers
 * the resulting `PushSubscription` with the push service. Requires
 * `Notification` permission to already be granted — this module never
 * requests it.
 */
export async function subscribeToPush(bearer: string): Promise<PushSubscribeOutcome> {
  if (!pushSupported()) return { kind: "unsupported" };
  if (getNotificationPermission() !== "granted") return { kind: "permission-denied" };

  try {
    const registration = await navigator.serviceWorker.ready;
    const publicKey = await fetchVapidPublicKey(bearer);
    if (publicKey === null) return { kind: "service-unreachable" };

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });

    const response = await fetch(pushUrl("/subscribe"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bearer}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(subscription.toJSON()),
    });
    if (!response.ok) return { kind: "service-unreachable" };
    return { kind: "subscribed" };
  } catch {
    return { kind: "service-unreachable" };
  }
}

/**
 * Unsubscribes from push, both server-side (best-effort) and browser-side.
 * `bearer` is `null` when called after the credential is already cleared —
 * callers should pass the bearer captured BEFORE sign-out clears it so the
 * server-side deregistration can still authenticate.
 */
export async function unsubscribeFromPush(bearer: string | null): Promise<void> {
  if (!pushSupported()) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription === null) return;
    if (bearer !== null) {
      await fetch(pushUrl("/unsubscribe"), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bearer}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      }).catch(() => {
        // Best-effort — the browser-side unsubscribe below still runs, and a
        // dead server-side registration prunes itself on the next failed send.
      });
    }
    await subscription.unsubscribe();
  } catch {
    // Best-effort — see doc comment above.
  }
}

async function fetchVapidPublicKey(bearer: string): Promise<string | null> {
  try {
    const response = await fetch(pushUrl("/vapid-public-key"), {
      headers: { Authorization: `Bearer ${bearer}` },
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { readonly publicKey?: unknown };
    return typeof body.publicKey === "string" ? body.publicKey : null;
  } catch {
    return null;
  }
}

function pushUrl(path: string): string {
  // `pushSupported()` guards every caller of this function on `PUSH_BASE_URL !== null`.
  return `${PUSH_BASE_URL}${path}`;
}

/**
 * Explicitly backed by a plain `ArrayBuffer` (not the wider `ArrayBufferLike`
 * a bare `new Uint8Array(length)` infers under this TS lib version) — the DOM
 * lib's `PushManager.subscribe` types `applicationServerKey` against
 * `BufferSource`/`ArrayBufferView<ArrayBuffer>` specifically.
 */
function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const buffer = new ArrayBuffer(raw.length);
  const output = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i += 1) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}
