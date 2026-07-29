/**
 * Long-running host stream connection, modeled directly on the CLI's
 * `traycer monitor` (`clients/traycer-cli/src/commands/monitor.ts`): the
 * shared `WsStreamClient` owns dial/handshake/ping-pong/reconnect-with-backoff;
 * this module layers on `host.notifications.feed.subscribe` frame handling,
 * the endpoint-poll-driven reconnect (so a host restart on a new port is
 * picked up without restarting this process), and the refresh-on-`UNAUTHORIZED`
 * recovery loop.
 */
import {
  hostNotificationsSubscribeServerFrameSchema,
  type HostNotificationsSubscribeServerFrame,
} from "@traycer/protocol/host/notifications/contracts";
import { hostStreamRpcRegistry, type HostStreamRpcRegistry } from "@traycer/protocol/host/registry";
import { MutableBearerLease } from "@traycer-clients/shared/auth/bearer-source";
import { createWhatwgStreamWebSocketFactory } from "@traycer-clients/shared/host-transport/whatwg-stream-ws-factory";
import type {
  IStreamSession,
  StreamCloseReason,
  StreamConnectionStatus,
  StreamFrameEnvelope,
} from "@traycer-clients/shared/host-transport/i-stream-session";
import type { HostTransportEndpoint } from "@traycer-clients/shared/host-transport/ws-rpc-client";
import { WsStreamClient } from "@traycer-clients/shared/host-transport/ws-stream-client";
import { DEFAULT_DIAL_TIMEOUT_MS } from "@traycer-clients/shared/host-transport/transport-config";
import type { ActionableDetector } from "./actionable-detector";
import {
  createBearerRevalidator,
  createPushServiceCredentialsStore,
  resolveHostAuth,
  type BearerRevalidator,
} from "./host-auth";
import { isValidLocalHostWebsocketUrl, readHostPidMetadata } from "./pid-metadata";
import { logError, logInfo, logWarn } from "./logger";

const SUBSCRIBE_METHOD = "host.notifications.feed.subscribe" as const;
const OPEN_ACK_TIMEOUT_MS = 10_000;
const PING_INTERVAL_MS = 25_000;
const PONG_TIMEOUT_MS = 60_000;
const INITIAL_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 30_000;
/** Re-read pid.json so a reconnect picks up a host restart on a new port. */
const ENDPOINT_POLL_MS = 2_000;
const HEALTHY_OPEN_MS = 10_000;
const AUTH_RETRY_DELAY_MS = 5_000;
const MAX_CONSECUTIVE_AUTH_REFRESHES = 3;
/** The initial snapshot only needs to seed dedup state; live `upserted` frames aren't scoped by this limit. */
const INITIAL_ATTENTION_LIMIT = 500;
const INITIAL_RECENT_LIMIT = 1;

/**
 * Runs the notifications subscription until an unrecoverable failure.
 * Resolves never on a healthy stream; rejects when the service should exit
 * (no credentials, or a terminal auth/protocol failure) — the CLI's
 * `monitor` has the identical contract with its own caller.
 */
export async function runHostNotificationsSubscription(
  detector: ActionableDetector,
): Promise<never> {
  const auth = await resolveHostAuth();
  if (auth === null) {
    throw new Error(
      "mobile-push-service: not signed in — run `traycer login` (or sign in via the desktop app) first.",
    );
  }

  const lease = new MutableBearerLease(auth.token, auth.userId);
  const store = createPushServiceCredentialsStore();
  const revalidator = createBearerRevalidator({ store, lease });

  let endpoint = await tryResolveStreamEndpoint();
  let pollInFlight = false;
  const poll = setInterval(() => {
    if (pollInFlight) return;
    pollInFlight = true;
    void tryResolveStreamEndpoint()
      .then((next) => {
        if (next !== null && !sameEndpoint(endpoint, next)) {
          endpoint = next;
          logInfo("host endpoint refreshed", { hostId: next.hostId });
        }
      })
      .finally(() => {
        pollInFlight = false;
      });
  }, ENDPOINT_POLL_MS);

  const client = new WsStreamClient<HostStreamRpcRegistry>({
    registry: hostStreamRpcRegistry,
    endpoint: () => endpoint,
    bearer: () => lease,
    // This module runs its own refresh-on-UNAUTHORIZED loop below (mirrors
    // the CLI monitor's `auth: null` — avoids double-handling the same
    // recovery in both places).
    auth: null,
    webSocketFactory: createWhatwgStreamWebSocketFactory(),
    dialTimeoutMs: DEFAULT_DIAL_TIMEOUT_MS,
    openAckTimeoutMs: OPEN_ACK_TIMEOUT_MS,
    pingIntervalMs: PING_INTERVAL_MS,
    pongTimeoutMs: PONG_TIMEOUT_MS,
    initialBackoffMs: INITIAL_BACKOFF_MS,
    maxBackoffMs: MAX_BACKOFF_MS,
  });

  try {
    return await runSubscriptionLoop(client, revalidator, detector);
  } finally {
    clearInterval(poll);
    store.dispose();
  }
}

function runSubscriptionLoop(
  client: WsStreamClient<HostStreamRpcRegistry>,
  revalidator: BearerRevalidator,
  detector: ActionableDetector,
): Promise<never> {
  return new Promise<never>((_resolve, reject) => {
    let session: IStreamSession | null = null;
    let authRefreshCount = 0;
    let healthTimer: NodeJS.Timeout | null = null;
    let retryTimer: NodeJS.Timeout | null = null;
    let settled = false;

    const clearHealthTimer = (): void => {
      if (healthTimer !== null) {
        clearTimeout(healthTimer);
        healthTimer = null;
      }
    };
    const clearRetryTimer = (): void => {
      if (retryTimer !== null) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
    };
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      logError("host notifications subscription failed", { message: error.message });
      clearHealthTimer();
      clearRetryTimer();
      session?.close();
      reject(error);
    };
    const markHealthy = (): void => {
      authRefreshCount = 0;
    };

    const subscribe = (): void => {
      clearRetryTimer();
      session?.close();
      const next = client.subscribe(SUBSCRIBE_METHOD, {
        initialAttentionLimit: INITIAL_ATTENTION_LIMIT,
        initialRecentLimit: INITIAL_RECENT_LIMIT,
      });
      session = next;
      next.onServerFrame((envelope) => {
        markHealthy();
        void handleServerFrame(envelope, detector);
      });
      next.onStatusChange((status, reason) => {
        void onStatusChange(status, reason);
      });
    };

    const onStatusChange = async (
      status: StreamConnectionStatus,
      reason: StreamCloseReason | null,
    ): Promise<void> => {
      if (settled) return;
      clearHealthTimer();
      if (status === "open") {
        healthTimer = setTimeout(markHealthy, HEALTHY_OPEN_MS);
        return;
      }
      if (status !== "closed" || reason === null || reason.kind !== "fatalError") {
        return;
      }
      if (reason.details.code !== "UNAUTHORIZED") {
        fail(new Error(`host closed the notifications stream: ${reason.details.reason}`));
        return;
      }
      const outcome = await revalidator.revalidateCurrentContext();
      if (settled) return;
      if (outcome === "rotated") {
        authRefreshCount += 1;
        if (authRefreshCount > MAX_CONSECUTIVE_AUTH_REFRESHES) {
          fail(
            new Error(
              `notifications subscription rejected after ${authRefreshCount} refreshes`,
            ),
          );
          return;
        }
        client.notifyBearerRotated();
        subscribe();
        return;
      }
      if (outcome === "network-error") {
        logWarn("auth refresh unavailable, retrying", { retryDelayMs: AUTH_RETRY_DELAY_MS });
        retryTimer = setTimeout(subscribe, AUTH_RETRY_DELAY_MS);
        return;
      }
      fail(new Error("notifications subscription session expired — re-authenticate"));
    };

    subscribe();
  });
}

async function handleServerFrame(
  envelope: StreamFrameEnvelope,
  detector: ActionableDetector,
): Promise<void> {
  const parsed = hostNotificationsSubscribeServerFrameSchema.safeParse(envelope);
  if (!parsed.success) {
    logWarn("dropped unrecognized notifications frame", { frameKind: String((envelope as { kind?: unknown }).kind) });
    return;
  }
  await routeFrame(parsed.data, detector);
}

async function routeFrame(
  frame: HostNotificationsSubscribeServerFrame,
  detector: ActionableDetector,
): Promise<void> {
  switch (frame.kind) {
    case "snapshot":
      await detector.seedFromSnapshot(frame.attention.entries);
      return;
    case "upserted":
      await detector.handleUpserted(frame.entry);
      return;
    case "removed":
      await detector.handleRemoved(frame.removedIds);
      return;
    case "cleared":
      await detector.handleRemoved(frame.removedIds);
      return;
    case "readStateChanged":
    case "channelEmission":
    case "pong":
      return;
  }
}

async function tryResolveStreamEndpoint(): Promise<HostTransportEndpoint | null> {
  const metadata = await readHostPidMetadata();
  if (metadata === null) return null;
  if (!isValidLocalHostWebsocketUrl(metadata.websocketUrl)) return null;
  return { hostId: metadata.hostId, websocketUrl: metadata.websocketUrl };
}

function sameEndpoint(
  current: HostTransportEndpoint | null,
  next: HostTransportEndpoint,
): boolean {
  return (
    current !== null &&
    current.hostId === next.hostId &&
    current.websocketUrl === next.websocketUrl
  );
}
