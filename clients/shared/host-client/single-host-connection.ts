/**
 * A unary `HostClient` bound to ONE statically-configured host.
 *
 * Extracted from `clients/mobile/src/host/connection.ts` when the Teams tab
 * needed the same stack — moved, not copied. The layering below is load-bearing
 * and subtle enough that two divergent copies of it is a guaranteed future bug;
 * the mobile module is now a thin wrapper supplying its own config.
 *
 * Assembles the same unary stack `gui-app` builds in
 * `host-runtime-provider.tsx`, but WITHOUT `HostRuntime`: a client with a
 * single host and no local-host directory to react to gets nothing from the
 * runtime's directory/selection machinery. Instead this fabricates one
 * `HostDirectoryEntry` from config and binds it directly.
 *
 * Order matters — see `createRetryingMessenger`'s doc: retry must sit OUTSIDE
 * the auth-aware wrapper.
 *
 *   WsRpcClient                       // per-request dial + versioned RPC
 *     → createAuthAwareMessenger      // closes the UNAUTHORIZED → revalidate loop
 *       → createRetryingMessenger     // re-dials pre-send transient failures
 *         → HostClient                // holds the bound host + RequestContext
 *
 * B1 guard: `HostClient` rejects every request until BOTH `bind(entry)` and
 * `setRequestContext(ctx)` have run. This module performs both and re-threads
 * the context on every auth transition, so this glue is what makes RPC
 * actually reachable.
 *
 * NOTHING HERE READS A CLIENT'S CONFIG. `hostWsUrl` and the local host label
 * are parameters, because the two callers have different config modules and an
 * import of either one would make this shared file un-shareable — which is how
 * it ended up living in `clients/mobile` in the first place.
 */
import { hostRpcRegistry } from "@traycer/protocol/host/index";
import type { HostRpcRegistry } from "@traycer/protocol/host/index";
import { v4 as uuidv4 } from "uuid";
import {
  WsRpcClient,
  HOST_POST_OPEN_ATTESTATION_WINDOW_MS,
} from "../host-transport/ws-rpc-client";
import { createWhatwgWebSocketFactory } from "../host-transport/whatwg-ws-factory";
import { createAuthAwareMessenger } from "../host-transport/auth-aware-messenger";
import {
  createRetryingMessenger,
  DEFAULT_TRANSPORT_RETRY_POLICY,
} from "../host-transport/retrying-messenger";
import { DEFAULT_DIAL_TIMEOUT_MS } from "../host-transport/transport-config";
import type { IHostMessenger } from "../host-transport/host-messenger";
import { HostClient, type IHostQueryInvalidator } from "./host-client";
import type { HostDirectoryEntry } from "./host-directory";
import type { AuthorityBoundAuthRevalidator } from "../auth/bearer-revalidator";
import type { RequestContext } from "@traycer/protocol/auth/request-context";
import type { RequestContextListener } from "../auth/request-context-provider";

/**
 * The slice of an auth service this module consumes. Deliberately narrow:
 * `createAuthAwareMessenger` needs the `AuthorityBoundAuthRevalidator`, and
 * `HostClient` needs the live `RequestContext` plus a change subscription.
 * Kept as an interface so a test can drive the glue with a fake, and so the
 * coupling stays exactly this surface.
 */
export interface HostConnectionAuth extends AuthorityBoundAuthRevalidator {
  current(): RequestContext | null;
  onChange(listener: RequestContextListener): () => void;
}

export interface HostConnection {
  readonly hostClient: HostClient<HostRpcRegistry>;
  /** Unsubscribes the auth listener; call on teardown. */
  dispose(): void;
}

/**
 * Builds the raw unary messenger for a registry. Mirrors gui-app's
 * `MessengerFactory` seam: production omits it and gets the real
 * `WsRpcClient`; the B1-guard test substitutes a mock so it can drive the REAL
 * wiring rather than a re-implementation of it.
 */
export type MessengerFactory = (args: {
  readonly registry: HostRpcRegistry;
}) => IHostMessenger<HostRpcRegistry>;

/**
 * Frame timeout after a successful dial. Mirrors gui-app's local
 * `DEFAULT_WS_FRAME_TIMEOUT_MS` (30 s) — there is no shared export for it,
 * only for the dial timeout. 30 s covers slow downstream host work (e.g. an
 * LLM call) without giving a stuck socket an unbounded lease.
 */
const DEFAULT_WS_FRAME_TIMEOUT_MS = 30_000;

const defaultMessengerFactory: MessengerFactory = ({ registry }) =>
  new WsRpcClient<HostRpcRegistry>({
    registry,
    requestId: uuidv4,
    webSocketFactory: createWhatwgWebSocketFactory(),
    dialTimeoutMs: DEFAULT_DIAL_TIMEOUT_MS,
    frameTimeoutMs: DEFAULT_WS_FRAME_TIMEOUT_MS,
    hostAttestationWindowMs: HOST_POST_OPEN_ATTESTATION_WINDOW_MS,
  });

/**
 * No-op `IHostQueryInvalidator`. `HostClient` calls `invalidateHostScope` on
 * every bind / context change, so it requires one — this is a real,
 * type-correct no-op rather than an `any`, for clients with no query cache to
 * drop. `cancelHostScope` is optional and omitted (no observers to cancel).
 */
export const NOOP_INVALIDATOR: IHostQueryInvalidator = {
  invalidateHostScope(): void {
    // No host-scoped cache; nothing to invalidate.
  },
};

export interface SingleHostConnectionOptions {
  /** `wss://…/rpc`. `null` means no host is configured; the caller renders a prompt. */
  readonly hostWsUrl: string | null;
  /**
   * LOCAL UI LABEL for the bound entry — what `HostClient` keys on. NOT the
   * host's real, durable id (`chatSchema.hostId`): that is a server-recognised
   * identity the wire protocol never exposes to a fresh client, so it cannot
   * be derived from this label. Where a durable binding is genuinely needed,
   * callers pass their configured host id explicitly.
   */
  readonly localHostId: string;
  /** Substitutes the raw messenger. Defaults to the real `WsRpcClient` factory. */
  readonly messengerFactory?: MessengerFactory;
  readonly invalidator?: IHostQueryInvalidator;
}

/**
 * Builds the unary `HostClient` for the configured host and threads auth into
 * it. Returns `null` when no host is configured, so the caller can render a
 * "not configured" prompt rather than bind a host that can never be dialed.
 */
export function createSingleHostConnection(
  auth: HostConnectionAuth,
  options: SingleHostConnectionOptions,
): HostConnection | null {
  const { hostWsUrl, localHostId } = options;
  if (hostWsUrl === null || hostWsUrl === "") {
    return null;
  }

  const rawMessenger = (options.messengerFactory ?? defaultMessengerFactory)({
    registry: hostRpcRegistry,
  });

  // Retry OUTSIDE auth-aware (gui-app order): the auth wrapper acts only on
  // UNAUTHORIZED, the retry wrapper only on pre-send RetryableTransportError,
  // so the two never contend and an auth-driven retry sits under one budget.
  const messenger = createRetryingMessenger<HostRpcRegistry>(
    createAuthAwareMessenger<HostRpcRegistry>(rawMessenger, auth),
    DEFAULT_TRANSPORT_RETRY_POLICY,
  );

  const hostClient = new HostClient<HostRpcRegistry>({
    registry: hostRpcRegistry,
    messenger,
    invalidator: options.invalidator ?? NOOP_INVALIDATOR,
  });

  const entry: HostDirectoryEntry = {
    hostId: localHostId,
    label: localHostId,
    kind: "local",
    websocketUrl: hostWsUrl,
    version: null,
    status: "available",
  };

  hostClient.bind(entry);
  hostClient.setRequestContext(auth.current());

  // Re-thread the context on every identity transition (sign-in / sign-out /
  // cross-user). `null` flows straight through — `setRequestContext` treats it
  // as an auth-changed transition and RPCs preflight-reject again.
  const unsubscribe = auth.onChange((ctx) => {
    hostClient.setRequestContext(ctx);
  });

  return {
    hostClient,
    dispose(): void {
      unsubscribe();
      hostClient.dispose();
    },
  };
}
