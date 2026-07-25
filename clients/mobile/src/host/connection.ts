// Host connection for the phone client.
//
// This reuses Traycer's own transport (`WsRpcClient`) and the CLI-style plain
// bearer seam (`MutableBearerLease`) — the exact path `bearer-source.ts`
// documents for clients that hold a bearer string. We deliberately talk to the
// messenger directly rather than through `HostClient`: a read/reply phone client
// needs the typed unary surface, not the desktop `HostRuntime` / `IRunnerHost`
// selection + cache machinery.
//
// The endpoint is a plain config value: a local `ws://127.0.0.1:<port>/rpc` in
// D1, a tailnet `wss://<host>.ts.net/rpc` in D4 — this module does not change.

import { MutableBearerLease } from "@traycer-clients/shared/auth/bearer-source";
import type {
  HostRequestAuthority,
  RequestOfMethod,
  ResponseOfMethod,
} from "@traycer-clients/shared/host-transport/host-messenger";
import { DEFAULT_DIAL_TIMEOUT_MS } from "@traycer-clients/shared/host-transport/transport-config";
import { WsRpcClient } from "@traycer-clients/shared/host-transport/ws-rpc-client";
import { createWhatwgWebSocketFactory } from "@traycer-clients/shared/host-transport/whatwg-ws-factory";
import { hostRpcRegistry } from "@traycer/protocol/host/registry";
import { v4 as uuidv4 } from "uuid";

/** Per-frame timeout after a successful dial (matches the desktop shell). */
const FRAME_TIMEOUT_MS = 30_000;

/** A stable id for the single host this client talks to. */
const LOCAL_HOST_ID = "traycer-remote-host";

export type HostRpcRegistry = typeof hostRpcRegistry;

export interface HostConnectionConfig {
  /** `ws://127.0.0.1:<port>/rpc` (D1) or `wss://<host>.ts.net/rpc` (D4). */
  readonly websocketUrl: string;
  /** Bearer token from Traycer's device-flow sign-in. */
  readonly bearerToken: string;
  /** The signed-in user id (used only for the same-user rotation guard). */
  readonly userId: string;
}

export interface HostConnection {
  request<Method extends keyof HostRpcRegistry & string>(
    method: Method,
    params: RequestOfMethod<HostRpcRegistry, Method>,
    signal?: AbortSignal,
  ): Promise<ResponseOfMethod<HostRpcRegistry, Method>>;
}

/**
 * Builds a typed host connection over Traycer's unary RPC transport. Each
 * `request` dials a fresh WebSocket, sends `open { token }`, runs the versioned
 * handshake, and returns the method's canonical response — all owned by
 * `WsRpcClient`.
 */
export function createHostConnection(
  config: HostConnectionConfig,
): HostConnection {
  const messenger = new WsRpcClient<HostRpcRegistry>({
    registry: hostRpcRegistry,
    requestId: () => uuidv4(),
    webSocketFactory: createWhatwgWebSocketFactory(),
    dialTimeoutMs: DEFAULT_DIAL_TIMEOUT_MS,
    frameTimeoutMs: FRAME_TIMEOUT_MS,
  });

  const bearer = new MutableBearerLease(config.bearerToken, config.userId);
  const endpoint = {
    hostId: LOCAL_HOST_ID,
    websocketUrl: config.websocketUrl,
  } as const;

  return {
    request(method, params, signal) {
      const authority: HostRequestAuthority = {
        endpoint,
        bearer,
        abortSignal: signal ?? new AbortController().signal,
      };
      return messenger.request(method, params, authority);
    },
  };
}
