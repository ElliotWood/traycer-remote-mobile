import webPush, { WebPushError } from "web-push";
import type { VapidKeys } from "./vapid-keys";
import type { PushSubscriptionKeys, SubscriptionStore } from "./subscription-store";
import { logWarn } from "./logger";

/** The exact payload shape delivered to `sw.ts`'s `push` listener. */
export interface PushPayload {
  readonly title: string;
  readonly body: string;
  readonly data: { readonly epicId: string; readonly chatId: string } | Record<string, never>;
}

interface RawSubscription {
  readonly endpoint: string;
  readonly keys: PushSubscriptionKeys;
}

interface VapidDetails {
  readonly subject: string;
  readonly publicKey: string;
  readonly privateKey: string;
}

/**
 * Injectable seam matching `web-push`'s `sendNotification` signature, so unit
 * tests can throw a real `WebPushError` shape without a network round trip.
 * Defaults to the real `web-push` package.
 */
export type SendNotificationFn = (
  subscription: RawSubscription,
  payload: string,
  options: { readonly vapidDetails: VapidDetails },
) => Promise<unknown>;

const defaultSend: SendNotificationFn = (subscription, payload, options) =>
  webPush.sendNotification(subscription, payload, options);

export interface PushSenderDeps {
  readonly vapidKeys: VapidKeys;
  readonly subscriptionStore: SubscriptionStore;
  readonly send?: SendNotificationFn;
}

export interface PushSender {
  /** Sends `payload` to every registered subscription. Prunes dead (410/404) subscriptions; leaves others on any other failure. */
  sendToAll(payload: PushPayload): Promise<void>;
}

export function createPushSender(deps: PushSenderDeps): PushSender {
  const send = deps.send ?? defaultSend;
  const vapidDetails: VapidDetails = {
    subject: deps.vapidKeys.subject,
    publicKey: deps.vapidKeys.publicKey,
    privateKey: deps.vapidKeys.privateKey,
  };

  return {
    async sendToAll(payload: PushPayload): Promise<void> {
      const subscriptions = deps.subscriptionStore.list();
      const body = JSON.stringify(payload);
      await Promise.all(
        subscriptions.map(async (sub) => {
          try {
            await send({ endpoint: sub.endpoint, keys: sub.keys }, body, {
              vapidDetails,
            });
          } catch (err) {
            const statusCode = webPushErrorStatusCode(err);
            if (statusCode === 410 || statusCode === 404) {
              await deps.subscriptionStore.remove(sub.endpoint);
              logWarn("pruned dead subscription", {
                statusCode,
                endpointSuffix: endpointSuffix(sub.endpoint),
              });
              return;
            }
            // Transient or unrecognized failure — leave the subscription in
            // place (don't prune on a network blip) and log without ever
            // touching the vapid keys or the raw error object.
            logWarn("push send failed, leaving subscription in place", {
              statusCode: statusCode ?? -1,
              endpointSuffix: endpointSuffix(sub.endpoint),
            });
          }
        }),
      );
    },
  };
}

/** `.statusCode` off a real `WebPushError`, or a duck-typed equivalent (test fakes). Never inspects `.body`/`.headers` — those may carry endpoint-identifying data we don't want in a log line. */
function webPushErrorStatusCode(err: unknown): number | null {
  if (err instanceof WebPushError) return err.statusCode;
  if (
    err !== null &&
    typeof err === "object" &&
    "statusCode" in err &&
    typeof (err as { statusCode: unknown }).statusCode === "number"
  ) {
    return (err as { statusCode: number }).statusCode;
  }
  return null;
}

/** Last 8 chars only — enough to correlate log lines without logging a full subscriber-identifying endpoint URL. */
function endpointSuffix(endpoint: string): string {
  return endpoint.slice(-8);
}
