import { ActionableDetector } from "./actionable-detector";
import { createHttpApiServer } from "./http-api";
import { runHostNotificationsSubscription } from "./host-notifications-client";
import { logError, logInfo } from "./logger";
import { buildPushPayload } from "./push-payload";
import { createPushSender } from "./push-sender";
import { PushedStateStore } from "./pushed-state-store";
import { SubscriptionStore } from "./subscription-store";
import { loadOrCreateVapidKeys } from "./vapid-keys";

/** `127.0.0.1` only — `tailscale serve` fronts it on the tailnet at `/push`; this process never binds a public interface itself. */
const HTTP_PORT = 5276;
const HTTP_HOST = "127.0.0.1";

async function main(): Promise<void> {
  const vapidKeys = await loadOrCreateVapidKeys();

  const subscriptionStore = new SubscriptionStore();
  await subscriptionStore.load();

  const pushedStateStore = new PushedStateStore();
  await pushedStateStore.load();

  const pushSender = createPushSender({ vapidKeys, subscriptionStore });

  const detector = new ActionableDetector({
    pushedStateStore,
    onBatch: async (transitions) => {
      if (transitions.length === 0) return;
      const payload = buildPushPayload(transitions);
      await pushSender.sendToAll(payload);
    },
  });

  const httpServer = createHttpApiServer({
    vapidPublicKey: vapidKeys.publicKey,
    subscriptionStore,
  });
  await new Promise<void>((resolve) => {
    httpServer.listen(HTTP_PORT, HTTP_HOST, resolve);
  });
  logInfo("http api listening", { host: HTTP_HOST, port: HTTP_PORT });

  await runHostNotificationsSubscription(detector);
}

main().catch((err: unknown) => {
  logError("mobile-push-service exiting", {
    message: err instanceof Error ? err.message : "unknown error",
  });
  process.exitCode = 1;
});
