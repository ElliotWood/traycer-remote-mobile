import { ActionableDetector } from "./actionable-detector";
import { createHttpApiServer } from "./http-api";
import { runHostNotificationsSubscription } from "./host-notifications-client";
import { logError, logInfo } from "./logger";
import { readHostPidMetadata } from "./pid-metadata";
import { buildPushPayload } from "./push-payload";
import { createPushSender } from "./push-sender";
import { PushedStateStore } from "./pushed-state-store";
import { SubscriptionStore } from "./subscription-store";
import { pushedStatePath, subscriptionsPath, vapidKeysPath } from "./storage/paths";
import { loadOrCreateVapidKeys } from "./vapid-keys";

/** `127.0.0.1` only — `tailscale serve` fronts it on the tailnet at `/push`; this process never binds a public interface itself. */
const HTTP_PORT = 5276;
const HTTP_HOST = "127.0.0.1";

async function main(): Promise<void> {
  const vapidKeys = await loadOrCreateVapidKeys(vapidKeysPath());

  const subscriptionStore = new SubscriptionStore(subscriptionsPath());
  await subscriptionStore.load();

  const pushedStateStore = new PushedStateStore(pushedStatePath());
  await pushedStateStore.load();

  const pushSender = createPushSender({ vapidKeys, subscriptionStore });

  const detector = new ActionableDetector({
    pushedStateStore,
    onBatch: async (transitions) => {
      if (transitions.length === 0) return;
      // Read per batch, not once at startup. The envelope's `originHostId` is
      // what stops a click landing on a same-id chat replicated onto another
      // host, so it has to describe the host this batch actually came from —
      // and `pid.json` is rewritten when the host restarts on a new port,
      // which is the same reason the subscription re-polls it.
      const hostId = (await readHostPidMetadata())?.hostId ?? null;
      const payload = buildPushPayload(transitions, hostId);
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
