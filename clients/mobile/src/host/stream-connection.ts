// Streaming connection for the phone client — the `chat.subscribe` side of the
// host (blocked state + reply frames). Mirrors connection.ts but over Traycer's
// `WsStreamClient`, with the same plain-bearer (`MutableBearerLease`) seam and a
// config-supplied endpoint (local ws:// now, tailnet wss:// in D4). Timings
// mirror gui-app's `buildHostStreamClient`.

import type { BearerSourceProvider } from "@traycer-clients/shared/auth/bearer-source";
import { MutableBearerLease } from "@traycer-clients/shared/auth/bearer-source";
import type { IStreamSession } from "@traycer-clients/shared/host-transport/i-stream-session";
import { DEFAULT_DIAL_TIMEOUT_MS } from "@traycer-clients/shared/host-transport/transport-config";
import type { HostEndpointProvider } from "@traycer-clients/shared/host-transport/ws-rpc-client";
import { WsStreamClient } from "@traycer-clients/shared/host-transport/ws-stream-client";
import { createWhatwgStreamWebSocketFactory } from "@traycer-clients/shared/host-transport/whatwg-stream-ws-factory";
import {
  hostStreamRpcRegistry,
  type HostStreamRpcRegistry,
} from "@traycer/protocol/host/registry";
import type { HostConnectionConfig } from "@/host/connection";

const OPEN_ACK_TIMEOUT_MS = 10_000;
const PING_INTERVAL_MS = 25_000;
const PONG_TIMEOUT_MS = 60_000;
const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
const LOCAL_HOST_ID = "traycer-remote-host";

export interface ChatStream {
  /** Opens a live `chat.subscribe` session for one chat. */
  subscribeChat(epicId: string, chatId: string): IStreamSession;
  /** Tears down the underlying stream client and all its sessions. */
  close(reason: string): void;
}

export function createChatStream(config: HostConnectionConfig): ChatStream {
  const endpoint: HostEndpointProvider = () => ({
    hostId: LOCAL_HOST_ID,
    websocketUrl: config.websocketUrl,
  });
  const lease = new MutableBearerLease(config.bearerToken, config.userId);
  const bearer: BearerSourceProvider = () => lease;

  const client = new WsStreamClient<HostStreamRpcRegistry>({
    registry: hostStreamRpcRegistry,
    endpoint,
    bearer,
    // A token-only client can't revalidate an expired bearer, so an
    // UNAUTHORIZED open is terminal (the documented `null` behaviour). A
    // device-flow sign-in can wire a revalidator here later.
    auth: null,
    webSocketFactory: createWhatwgStreamWebSocketFactory(),
    dialTimeoutMs: DEFAULT_DIAL_TIMEOUT_MS,
    openAckTimeoutMs: OPEN_ACK_TIMEOUT_MS,
    pingIntervalMs: PING_INTERVAL_MS,
    pongTimeoutMs: PONG_TIMEOUT_MS,
    initialBackoffMs: INITIAL_BACKOFF_MS,
    maxBackoffMs: MAX_BACKOFF_MS,
  });

  return {
    subscribeChat(epicId, chatId) {
      return client.subscribe("chat.subscribe", { epicId, chatId });
    },
    close(reason) {
      client.close(reason);
    },
  };
}
