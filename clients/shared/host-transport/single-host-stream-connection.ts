/**
 * Single-host `/stream` transport, shared by the phone and the Teams tab.
 *
 * MOVED from `clients/mobile/src/host/stream-connection.ts`, for the same
 * reason and at the same seam as the unary connection before it: the module
 * was mobile-only because it imported mobile's `@/config` for the endpoint and
 * took a concrete `MobileAuthService`. Both are now parameters, and nothing
 * here reads a client's config.
 *
 * Stands up the streaming stack the phone client uses for `epic.subscribe`
 * (T5) and `chat.subscribe` (T6). It owns ONE `WsStreamClient` per signed-in
 * session; every `openEpicStream` / `openChatStream` call opens an independent
 * self-reconnecting session off that shared client.
 *
 * Deliberately NOT included (tech plan slice 5, ticket T3 "Out"):
 *   - gui-app's durability wrappers (`stream-runtime`, `durable-stream-transport`,
 *     refcounting). The raw `WsStreamClient` already self-reconnects, which is
 *     all the phone needs.
 *   - The Y.Doc decode of the epic snapshot (T5) and chat reply frames (T6).
 *     This module only stands up the transport and the connection-state surface;
 *     snapshot/frame payloads pass through the caller's callbacks untouched.
 *
 * Bearer (R3, decisions doc): the transport `bearer` reads the live
 * `ctx.credentials` seam directly — `() => auth.current()?.credentials ?? null`.
 * There is NO `MutableBearerLease` here (that exists only for the CLI's raw
 * token string). A same-user refresh rotates the lease in place; we forward the
 * host `credentialUpdate` via `onBearerRotated` → `notifyBearerRotated`, exactly
 * like gui-app's `useHostStreamClientBindingFor`.
 */
import { WsStreamClient } from "./ws-stream-client";
import { DEFAULT_DIAL_TIMEOUT_MS } from "./transport-config";
import { createWhatwgStreamWebSocketFactory } from "./whatwg-stream-ws-factory";
import type { HostEndpointProvider } from "./ws-rpc-client";
import type {
  RevalidateOutcome,
  StreamAuthRevalidator,
} from "../auth/bearer-revalidator";
import {
  ChatStreamClient,
  type ChatStreamCallbacks,
} from "./chat-stream-client";
import {
  EpicStreamClient,
  type EpicStreamCallbacks,
} from "./epic-stream-client";
import type {
  StreamCloseReason,
  StreamConnectionStatus,
} from "./i-stream-session";
import type { RequestContext } from "@traycer/protocol/auth/request-context";
import {
  hostStreamRpcRegistry,
  type HostStreamRpcRegistry,
} from "@traycer/protocol/host/registry";

/**
 * Per-session dial / handshake / heartbeat timings. Copied verbatim from
 * gui-app's `use-host-stream-client-for.ts` (the single source those constants
 * live at) so the phone behaves identically on the wire: ping ~25s (decision
 * #14), pong cutoff 60s, backoff 1s → 30s.
 */
// Exported (not just module-local) so HA-4's two-tier connection manager
// dials a watching-tier client with the SAME timing profile as the driving
// one, rather than a second copied set of magic numbers.
export const OPEN_ACK_TIMEOUT_MS = 10_000;
export const PING_INTERVAL_MS = 25_000;
export const PONG_TIMEOUT_MS = 60_000;
export const INITIAL_BACKOFF_MS = 1_000;
export const MAX_BACKOFF_MS = 30_000;

/**
 * Endpoint identity for the single fixed host the phone dials. Mobile has no
 * host directory (only `HOST_WS_URL` in config), so `hostId` is a stable label
 * — the stream client reads only `websocketUrl` (rewriting `/rpc`→`/stream` via
 * `toStreamDialUrl`); `hostId` is carried for endpoint identity only.
 */
export const DEFAULT_STREAM_HOST_ID = "traycer-remote-host";

export interface SingleHostStreamOptions {
  /** `wss://…/rpc`; the client rewrites `/rpc`→`/stream` itself. */
  readonly hostWsUrl: string | null;
  /** Endpoint identity only — the transport reads just `websocketUrl`. */
  readonly hostId?: string;
}

/**
 * Connection state projected for the UI: the four transport statuses collapsed
 * to the three the phone renders. `connecting` and `reconnecting` both read as
 * "reconnecting" (not live yet / lost and retrying); `open` is "live"; `closed`
 * is "disconnected" (terminal — caller close or a host fatalError).
 */
export type StreamConnectionState = "live" | "reconnecting" | "disconnected";

export function toConnectionState(
  status: StreamConnectionStatus,
): StreamConnectionState {
  switch (status) {
    case "open":
      return "live";
    case "connecting":
    case "reconnecting":
      return "reconnecting";
    case "closed":
      return "disconnected";
  }
}

/**
 * Tiny observable holding the current `StreamConnectionState`. Framework-
 * agnostic (no React import) so it is unit-testable directly; the React surface
 * is the `useStreamConnectionState` hook, which wires this into
 * `useSyncExternalStore`. `getState` returns a primitive string, so the hook's
 * snapshot is referentially stable and never loops.
 */
export class StreamConnectionStateStore {
  private state: StreamConnectionState = "reconnecting";
  private lastReason: StreamCloseReason | null = null;
  private readonly listeners = new Set<() => void>();

  /** Feeds a raw transport status transition in; notifies only on real change. */
  applyStatus(
    status: StreamConnectionStatus,
    reason: StreamCloseReason | null,
  ): void {
    this.lastReason = reason;
    const next = toConnectionState(status);
    if (next === this.state) {
      return;
    }
    this.state = next;
    for (const listener of [...this.listeners]) {
      listener();
    }
  }

  /** The close reason attached to the most recent transition (or null). */
  reason(): StreamCloseReason | null {
    return this.lastReason;
  }

  // Bound so they can be passed straight to `useSyncExternalStore`.
  readonly getState = (): StreamConnectionState => this.state;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
}

/** An opened stream plus its connection-state signal. */
export interface OpenStreamHandle<Client> {
  readonly stream: Client;
  readonly connection: StreamConnectionStateStore;
}

/**
 * Wraps the caller's callbacks so every `onConnectionStatus` also drives a fresh
 * `StreamConnectionStateStore`, then opens the chat session. The caller's own
 * `onConnectionStatus` (and every frame callback — snapshot decode is T6) still
 * fires unchanged; T3 only adds the connection-state projection alongside.
 */
export function openChatStream(
  client: WsStreamClient<HostStreamRpcRegistry>,
  params: {
    readonly epicId: string;
    readonly chatId: string;
    readonly callbacks: ChatStreamCallbacks;
  },
): OpenStreamHandle<ChatStreamClient> {
  const connection = new StreamConnectionStateStore();
  const callbacks: ChatStreamCallbacks = {
    ...params.callbacks,
    onConnectionStatus: (status, reason) => {
      connection.applyStatus(status, reason);
      params.callbacks.onConnectionStatus(status, reason);
    },
  };
  const stream = new ChatStreamClient({
    wsStreamClient: client,
    epicId: params.epicId,
    chatId: params.chatId,
    callbacks,
  });
  return { stream, connection };
}

/** Epic-stream counterpart of `openChatStream`. Snapshot decode is T5. */
export function openEpicStream(
  client: WsStreamClient<HostStreamRpcRegistry>,
  params: {
    readonly epicId: string;
    readonly callbacks: EpicStreamCallbacks;
  },
): OpenStreamHandle<EpicStreamClient> {
  const connection = new StreamConnectionStateStore();
  const callbacks: EpicStreamCallbacks = {
    ...params.callbacks,
    onConnectionStatus: (status, reason) => {
      connection.applyStatus(status, reason);
      params.callbacks.onConnectionStatus(status, reason);
    },
  };
  const stream = new EpicStreamClient({
    wsStreamClient: client,
    epicId: params.epicId,
    callbacks,
  });
  return { stream, connection };
}

/**
 * The slice of an auth service this module consumes.
 *
 * Three methods, declared rather than importing a concrete service: the tab
 * and the phone hold different auth objects, and depending on either one is
 * what kept this module in `clients/mobile` while both clients needed it.
 */
export interface StreamConnectionAuth {
  /**
   * The live request context. `credentials` is read directly as the
   * transport's bearer source — R3, no `MutableBearerLease`, which exists
   * only for the CLI's raw token string.
   */
  current(): RequestContext | null;
  onBearerRotated(listener: () => void): () => void;
  revalidateCurrentContext(): Promise<{ readonly kind: string } | null>;
}

/**
 * Adapts an auth service to the `StreamAuthRevalidator` the transport calls
 * on a host `UNAUTHORIZED` open-frame rejection (overnight-wake: the bearer
 * expired during sleep). Routes through the SAME single-flight
 * `revalidateCurrentContext` unary RPC uses, and maps its outcome to the
 * transport's normalized signal — mirrors gui-app's `useStreamAuthRevalidator`:
 *
 *   - null (no live context) / rejected → "rejected"  (terminal; already signed out)
 *   - valid                             → "rotated"    (re-dial with the live bearer)
 *   - network-error                     → "network-error" (stay in backoff)
 */
export function createStreamAuthRevalidator(
  auth: StreamConnectionAuth,
): StreamAuthRevalidator {
  return {
    revalidateForReconnect: async (): Promise<RevalidateOutcome> => {
      const outcome = await auth.revalidateCurrentContext();
      if (outcome === null) {
        return "rejected";
      }
      if (outcome.kind === "valid") {
        return "rotated";
      }
      if (outcome.kind === "network-error") {
        return "network-error";
      }
      return "rejected";
    },
  };
}

/**
 * Owns the single mobile `WsStreamClient` for a signed-in session. Construct it
 * with the shared `MobileAuthService`; open epic/chat streams off it; `close()`
 * on sign-out to tear down every session and stop reconnecting.
 */
export class HostStreamConnection {
  readonly client: WsStreamClient<HostStreamRpcRegistry>;
  private readonly unsubscribeBearerRotation: () => void;

  constructor(auth: StreamConnectionAuth, options: SingleHostStreamOptions) {
    const { hostWsUrl, hostId = DEFAULT_STREAM_HOST_ID } = options;
    const endpoint: HostEndpointProvider = () =>
      hostWsUrl !== null && hostWsUrl !== ""
        ? { hostId, websocketUrl: hostWsUrl }
        : null;

    this.client = new WsStreamClient<HostStreamRpcRegistry>({
      registry: hostStreamRpcRegistry,
      endpoint,
      // R3: read the live credential lease; no MutableBearerLease.
      bearer: () => auth.current()?.credentials ?? null,
      auth: createStreamAuthRevalidator(auth),
      // This client has no delegated host-credential-provisioning policy (that's
      // a desktop-app concern — see `HostCredentialMintFlow`); opting out is the
      // documented, correct choice for a client that isn't gui-app's app-wide
      // provisioning provider.
      hostCredentialMint: null,
      webSocketFactory: createWhatwgStreamWebSocketFactory(),
      dialTimeoutMs: DEFAULT_DIAL_TIMEOUT_MS,
      openAckTimeoutMs: OPEN_ACK_TIMEOUT_MS,
      pingIntervalMs: PING_INTERVAL_MS,
      pongTimeoutMs: PONG_TIMEOUT_MS,
      initialBackoffMs: INITIAL_BACKOFF_MS,
      maxBackoffMs: MAX_BACKOFF_MS,
    });

    // A same-user refresh rotates the lease in place (silent on `onChange`), so
    // subscribe to the dedicated rotation signal and push the fresh bearer onto
    // every open session — the host updates its credential without a reconnect.
    this.unsubscribeBearerRotation = auth.onBearerRotated(() => {
      this.client.notifyBearerRotated();
    });
  }

  openEpic(params: {
    readonly epicId: string;
    readonly callbacks: EpicStreamCallbacks;
  }): OpenStreamHandle<EpicStreamClient> {
    return openEpicStream(this.client, params);
  }

  openChat(params: {
    readonly epicId: string;
    readonly chatId: string;
    readonly callbacks: ChatStreamCallbacks;
  }): OpenStreamHandle<ChatStreamClient> {
    return openChatStream(this.client, params);
  }

  /**
   * Forces every open session (the epic stream AND every per-chat badge/chat
   * stream, since they share this one client) to drop and immediately re-dial.
   * S5 passthrough to `WsStreamClient.reconnectAll` — the transport already
   * built this for gui-app's device-wake case; mobile's `liveness-recovery`
   * wires it to focus/visibility/online signals. No-op on a closed client.
   */
  reconnectAll(reason: string): void {
    this.client.reconnectAll(reason);
  }

  /** Tears down every open session and stops reconnecting. Idempotent. */
  close(reason: string): void {
    this.unsubscribeBearerRotation();
    this.client.close(reason);
  }
}
