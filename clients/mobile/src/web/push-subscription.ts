/**
 * Registers this browser with `mobile-push-service` so a blocked agent can
 * reach the user while the app is CLOSED.
 *
 * WHAT THIS IS THE LAST PIECE OF. `sw.ts` already handles `push` and routes the
 * tap; `web-notification-host.ts` already displays a foreground notification;
 * the service already formats the payload and signs it with VAPID. Every one of
 * those was built, tested and deployed — and none of them could ever fire,
 * because nothing had ever called `PushManager.subscribe`. A push service with
 * no subscriptions sends to an empty list, silently and successfully.
 *
 * FOREGROUND NOTIFICATIONS DO NOT NEED THIS. Upstream emits those over the
 * socket the app already holds open. This buys exactly one thing: delivery when
 * there is no open tab — which is the case the whole feature exists for.
 *
 * THE SERVICE IS SAME-ORIGIN, at `/push`. Its `http-api.ts` mounts its routes
 * PREFIX-FREE (`/vapid-public-key`, `/subscribe`) on the deliberate assumption
 * that whatever fronts it strips the prefix, so `/push/vapid-public-key` here
 * meets `/vapid-public-key` there. Same-origin is not incidental: the service
 * has no CORS handling at all, so a cross-origin call would fail preflight
 * before its bearer check ever ran.
 *
 * THE OUTCOME IS EXTERNALLY READABLE at `<html data-push>`, with every negative
 * state kept distinct — same device as `data-notifications`, `data-wake-lock`
 * and `data-storage-durable`, and for the same reason: `permission`,
 * `signed-out` and `unavailable` want three different next actions, and a probe
 * that can only see "not subscribed" cannot tell which one it is looking at.
 *
 * DISCLOSED REDUCTION — `pushsubscriptionchange` IS NOT HANDLED IN THE WORKER,
 * and it cannot be. A browser may rotate a subscription on its own, while the
 * app is closed; the spec's remedy is a worker-side `pushsubscriptionchange`
 * handler that re-subscribes and re-registers. The re-subscribe half is
 * possible there — `event.oldSubscription.options.applicationServerKey` carries
 * the key — but the re-register half is not: `/subscribe` requires a bearer,
 * and the worker has none. Parking a token in the worker to buy this would put
 * a credential somewhere nothing else in this client keeps one.
 *
 * So the repair is page-side and happens on the next open: this function runs
 * on every load, sees a subscription whose endpoint the service does not have,
 * and upserts it. The honest consequence is a window — from the rotation until
 * the user next opens the app — in which background push silently does not
 * arrive. Stated the way the wake-lock reduction was, as a named test rather
 * than a sentence, because this epic has already shipped a disclosed reduction
 * whose stated mechanism did not exist.
 */

/**
 * Same-origin, and a PATH rather than a full URL so it follows the deployment
 * it is served from without a build flag to keep in sync.
 */
export const PUSH_BASE_PATH = "/push";

export type PushSubscriptionOutcome =
  /** An active subscription exists AND the service has been told about it. */
  | "subscribed"
  /** Notification permission is not granted, so `subscribe` would reject. */
  | "permission"
  /** No `PushManager` here — a Teams tab, an insecure origin, jsdom, iOS Safari before 16.4. */
  | "unsupported"
  /** No bearer to present, so every route would 401. */
  | "signed-out"
  /** The service did not answer, refused, or the browser's push service refused. */
  | "unavailable";

/**
 * The push surface this module uses, named as the narrowest shape that covers
 * it — the posture `pwa-shell.ts` and `web-notification-host.ts` both take. The
 * real `PushManager`/`PushSubscription` are assignable to these, so production
 * passes the genuine article while a test constructs one outright instead of
 * asserting a partial fake past a DOM interface it never touches.
 */
export interface PushSubscriptionLike {
  readonly endpoint: string;
  readonly options: { readonly applicationServerKey: ArrayBuffer | null };
  toJSON(): { keys?: Record<string, string> | undefined };
  unsubscribe(): Promise<boolean>;
}

export interface PushManagerLike {
  getSubscription(): Promise<PushSubscriptionLike | null>;
  subscribe(options: {
    userVisibleOnly: boolean;
    // `Uint8Array<ArrayBuffer>`, not a bare `Uint8Array`. Since TS 5.7 the bare
    // form widens to `ArrayBufferLike`, which admits a `SharedArrayBuffer` and
    // is therefore NOT assignable to the DOM's `BufferSource` — so the real
    // `PushManager` stops being assignable to this interface and the narrow
    // shape quietly stops covering the thing it exists to describe.
    applicationServerKey: Uint8Array<ArrayBuffer>;
  }): Promise<PushSubscriptionLike>;
}

export interface PushRegistrationLike {
  readonly pushManager?: PushManagerLike | undefined;
}

export interface PushServiceWorkerHost {
  readonly ready: Promise<PushRegistrationLike>;
}

/** The two things this module reads off a response. `Response` is assignable to it. */
export interface PushResponseLike {
  readonly ok: boolean;
  json(): Promise<unknown>;
}

/**
 * The narrowest shape of `fetch` this module uses. The real `fetch` is
 * assignable — this exists so a test can pass a plain function instead of
 * asserting a fake past `typeof globalThis.fetch`, whose overloads and
 * `Response` return type it would have to fabricate wholesale.
 */
export type PushFetch = (
  url: string,
  init: RequestInit,
) => Promise<PushResponseLike>;

export interface EnsurePushSubscriptionOptions {
  /** Defaults to `navigator.serviceWorker`. Injected in tests. */
  readonly serviceWorker?: PushServiceWorkerHost | undefined;
  /** Defaults to reading `Notification.permission`. */
  readonly getPermission?: (() => string) | undefined;
  /** The signed-in user's access token, or `null`. */
  readonly getBearer?: (() => Promise<string | null>) | undefined;
  readonly fetch?: PushFetch | undefined;
  /** Defaults to {@link PUSH_BASE_PATH}. */
  readonly baseUrl?: string | undefined;
  /** Reports the outcome. Defaults to stamping `<html data-push>`. */
  readonly report?: ((outcome: PushSubscriptionOutcome) => void) | undefined;
}

/**
 * Brings this browser's push subscription into line with the service, and says
 * what happened.
 *
 * `void` and never throws, for the same reason `registerServiceWorker` does not:
 * no push is a degradation, a rejected promise on the boot path is an outage.
 *
 * SAFE TO CALL REPEATEDLY, and it is meant to be — on every load and again the
 * moment permission is granted. That is not belt-and-braces, it is the repair
 * mechanism for a rotated subscription; see the disclosed reduction above.
 */
export async function ensurePushSubscription(
  options: EnsurePushSubscriptionOptions,
): Promise<PushSubscriptionOutcome> {
  const report =
    options.report ??
    ((outcome: PushSubscriptionOutcome): void => {
      document.documentElement.dataset.push = outcome;
    });

  const outcome = await resolve(options);
  report(outcome);
  return outcome;
}

async function resolve(
  options: EnsurePushSubscriptionOptions,
): Promise<PushSubscriptionOutcome> {
  const getPermission = options.getPermission ?? readNotificationPermission;
  // Checked FIRST, before any network call. `subscribe({userVisibleOnly:true})`
  // rejects outright without the notification grant, so asking the service for
  // its key beforehand would spend a request to learn nothing.
  if (getPermission() !== "granted") return "permission";

  const container: PushServiceWorkerHost | undefined =
    options.serviceWorker ?? globalThis.navigator?.serviceWorker ?? undefined;
  if (container === undefined) return "unsupported";

  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const base = options.baseUrl ?? PUSH_BASE_PATH;

  const bearer = await (options.getBearer?.() ?? Promise.resolve(null));
  // Before touching the browser's push service. A subscription created while
  // signed out cannot be delivered to anyone — it would sit in the browser
  // unregistered, and the next signed-in run would find it "already there".
  if (bearer === null || bearer.length === 0) return "signed-out";

  let registration: PushRegistrationLike;
  try {
    registration = await container.ready;
  } catch {
    // `ready` never resolves in an unregistered document and rejects where
    // registration itself is forbidden — a storage-denied third-party frame,
    // which is the Teams tab this same bundle serves.
    return "unsupported";
  }
  const manager = registration.pushManager;
  // Typed as always present on a `ServiceWorkerRegistration`; absent in
  // reality in a cross-origin frame without the `push` permission policy, and
  // in every browser that ships service workers without the Push API.
  if (manager === undefined || manager === null) return "unsupported";

  const serverKey = await fetchVapidPublicKey(doFetch, base, bearer);
  if (serverKey === null) return "unavailable";

  let subscription: PushSubscriptionLike | null;
  try {
    subscription = await manager.getSubscription();

    // A subscription made against a DIFFERENT VAPID key is undeliverable and
    // completely silent about it: the browser keeps it, the service signs with
    // the key it has now, and the push is rejected at a server the user will
    // never see a log line from. The service regenerates its keypair whenever
    // its `vapid.json` is missing, so this is a reachable state and not a
    // theoretical one — first run after a wiped state directory does exactly
    // this to every subscriber.
    if (
      subscription !== null &&
      !sameKey(subscription.options.applicationServerKey, serverKey)
    ) {
      await subscription.unsubscribe();
      subscription = null;
    }

    subscription ??= await manager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: serverKey,
    });
  } catch {
    // `subscribe` rejects when the browser cannot reach its own push service —
    // offline, or a Chrome build with no push provider configured. Nothing here
    // is our failure to fix, and it is not the user's to act on either.
    return "unavailable";
  }

  const keys = subscription.toJSON().keys;
  const p256dh = keys?.p256dh;
  const auth = keys?.auth;
  // The service's `subscribeBodySchema` rejects a body missing either, so a
  // subscription without them is not a push we can deliver. Reported rather
  // than posted, so the failure reads as "no push" instead of a 400 nobody
  // sees.
  if (typeof p256dh !== "string" || typeof auth !== "string") {
    return "unavailable";
  }

  // POSTED EVEN WHEN THE SUBSCRIPTION WAS ALREADY THERE. `/subscribe` is an
  // upsert keyed by endpoint, so this costs one request and repairs the case
  // that is otherwise unrecoverable: the browser still holds a valid
  // subscription while the service's store has lost it (a fresh state
  // directory, a restore, a wiped VM). Without this the client would conclude
  // it is subscribed forever and the service would never hear of it.
  const posted = await postSubscription(doFetch, base, bearer, {
    endpoint: subscription.endpoint,
    keys: { p256dh, auth },
  });
  return posted ? "subscribed" : "unavailable";
}

async function fetchVapidPublicKey(
  doFetch: PushFetch,
  base: string,
  bearer: string,
): Promise<Uint8Array<ArrayBuffer> | null> {
  let response: PushResponseLike;
  try {
    response = await doFetch(`${base}/vapid-public-key`, {
      headers: { authorization: `Bearer ${bearer}` },
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return null;
  }
  if (body === null || typeof body !== "object") return null;
  const publicKey = (body as { publicKey?: unknown }).publicKey;
  if (typeof publicKey !== "string" || publicKey.length === 0) return null;
  try {
    return base64UrlToBytes(publicKey);
  } catch {
    return null;
  }
}

async function postSubscription(
  doFetch: PushFetch,
  base: string,
  bearer: string,
  body: { endpoint: string; keys: { p256dh: string; auth: string } },
): Promise<boolean> {
  try {
    const response = await doFetch(`${base}/subscribe`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${bearer}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Reads `Notification.permission` without assuming `Notification` exists.
 *
 * Duplicated from `web-notification-host.ts` rather than imported, and this is
 * the one thing in this module that is a judgement call: importing it would pull
 * the notification host — and its `INotificationHost` type surface — into the
 * boot path for a two-line read. The behaviour is identical and both are
 * covered by their own tests.
 */
function readNotificationPermission(): string {
  const ctor = (globalThis as { Notification?: { permission?: unknown } })
    .Notification;
  if (ctor === undefined) return "unsupported";
  return typeof ctor.permission === "string" ? ctor.permission : "unsupported";
}

/**
 * Decodes a base64url VAPID public key to the bytes `subscribe` wants.
 *
 * NOT `atob` on the raw string, and the reason is measured rather than assumed.
 * `web-push`'s `generateVAPIDKeys()` emits base64URL — `-` and `_` in place of
 * `+` and `/` — and `atob` THROWS on those characters, so the naive version
 * fails on every key that happens to contain one and works on the rest. That is
 * the worst available split for something tested once with one fixture, which
 * is why this module's fixture is a real generated key carrying both.
 *
 * The padding is belt rather than braces: V8's `atob` tolerates an unpadded
 * 87-character key, but that tolerance is engine-dependent and not something
 * this client can measure on the phones it runs on. Padding costs one line.
 */
export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Byte equality between an existing subscription's key and the service's current one. A `null` key (a subscription made with no VAPID identity at all) never matches. */
function sameKey(existing: ArrayBuffer | null, wanted: Uint8Array): boolean {
  if (existing === null) return false;
  const bytes = new Uint8Array(existing);
  if (bytes.length !== wanted.length) return false;
  return bytes.every((byte, index) => byte === wanted[index]);
}
