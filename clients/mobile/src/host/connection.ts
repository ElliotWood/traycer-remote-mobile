/**
 * Unary host connection for the mobile client (T2).
 *
 * Assembles the exact same unary stack `gui-app` builds in
 * `host-runtime-provider.tsx`, but WITHOUT `HostRuntime`: mobile has a single,
 * statically-configured host (`HOST_WS_URL`) and no local-host directory to
 * react to, so the runtime's directory/selection machinery buys nothing here.
 * Instead this fabricates one `HostDirectoryEntry` from config and binds it
 * directly.
 *
 * The layering mirrors gui-app exactly (order matters — see
 * `createRetryingMessenger`'s doc: retry must sit OUTSIDE the auth-aware
 * wrapper):
 *
 *   WsRpcClient                       // per-request dial + versioned RPC
 *     → createAuthAwareMessenger      // closes the UNAUTHORIZED → revalidate loop
 *       → createRetryingMessenger     // re-dials pre-send transient failures
 *         → HostClient                // holds the bound host + RequestContext
 *
 * B1 guard: `HostClient` rejects every request until BOTH `bind(entry)` and
 * `setRequestContext(ctx)` have run (see `HostClient.readRequestPreflightError`
 * / `scheduleRequest`). This module performs both, and re-threads the context on
 * every auth transition, so the glue is what makes RPC actually reachable.
 */
import { hostRpcRegistry } from "@traycer/protocol/host/index";
import type { HostRpcRegistry } from "@traycer/protocol/host/index";
import { v4 as uuidv4 } from "uuid";
import { WsRpcClient } from "@traycer-clients/shared/host-transport/ws-rpc-client";
import { createWhatwgWebSocketFactory } from "@traycer-clients/shared/host-transport/whatwg-ws-factory";
import { createAuthAwareMessenger } from "@traycer-clients/shared/host-transport/auth-aware-messenger";
import {
  createRetryingMessenger,
  DEFAULT_TRANSPORT_RETRY_POLICY,
} from "@traycer-clients/shared/host-transport/retrying-messenger";
import { DEFAULT_DIAL_TIMEOUT_MS } from "@traycer-clients/shared/host-transport/transport-config";
import type { IHostMessenger } from "@traycer-clients/shared/host-transport/host-messenger";
import {
  HostClient,
  type IHostQueryInvalidator,
} from "@traycer-clients/shared/host-client/host-client";
import type { HostDirectoryEntry } from "@traycer-clients/shared/host-client/host-directory";
import type { AuthorityBoundAuthRevalidator } from "@traycer-clients/shared/auth/bearer-revalidator";
import type { RequestContext } from "@traycer/protocol/auth/request-context";
import type { RequestContextListener } from "@traycer-clients/shared/auth/request-context-provider";
import { HOST_WS_URL } from "@/config";

/**
 * The slice of `MobileAuthService` this module consumes. Deliberately narrow:
 * `createAuthAwareMessenger` needs the `AuthorityBoundAuthRevalidator`, and the
 * `HostClient` needs the live `RequestContext` plus a change subscription. Kept
 * as an interface (not `MobileAuthService`) so the smoke test can drive the glue
 * with a fake and so the coupling stays exactly this surface.
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
 * Builds the raw unary messenger (the `WsRpcClient`) for a registry. Mirrors
 * gui-app's `MessengerFactory` seam (`host-runtime-provider.tsx` `messengerFactory`
 * prop): production omits it and gets the real `WsRpcClient`; the B1-guard test
 * substitutes a mock so it can drive the REAL `createHostConnection` wiring.
 */
export type MessengerFactory = (args: {
  readonly registry: HostRpcRegistry;
}) => IHostMessenger<HostRpcRegistry>;

/**
 * Test/override seam. Both fields default to production values, so the default
 * `createHostConnection(auth)` path is byte-identical to the un-injected build.
 */
export interface HostConnectionDeps {
  /** Substitutes the raw messenger. Defaults to the real `WsRpcClient` factory. */
  readonly messengerFactory?: MessengerFactory;
  /** Overrides the configured host URL. Defaults to `HOST_WS_URL` from config. */
  readonly hostWsUrl?: string | null;
}

/** Production raw-messenger factory: a fresh `WsRpcClient` over the WHATWG socket. */
const defaultMessengerFactory: MessengerFactory = ({ registry }) =>
  new WsRpcClient<HostRpcRegistry>({
    registry,
    requestId: uuidv4,
    webSocketFactory: createWhatwgWebSocketFactory(),
    dialTimeoutMs: DEFAULT_DIAL_TIMEOUT_MS,
    frameTimeoutMs: DEFAULT_WS_FRAME_TIMEOUT_MS,
  });

/**
 * Frame timeout after a successful dial. Mirrors gui-app's local
 * `DEFAULT_WS_FRAME_TIMEOUT_MS` (30 s) — there is no shared export for it, only
 * for the dial timeout (`DEFAULT_DIAL_TIMEOUT_MS`). 30 s covers slow downstream
 * host work (e.g. an LLM call) without giving a stuck socket an unbounded lease.
 */
const DEFAULT_WS_FRAME_TIMEOUT_MS = 30_000;

/**
 * Stable id for the single mobile-configured host. Exported so RPCs that must
 * name the bound host explicitly (e.g. `epic.createChat`'s `hostId`, T7) stamp
 * the SAME id this connection binds its `HostDirectoryEntry` to — otherwise the
 * created chat would be bound to a host the client never dialed.
 */
export const MOBILE_HOST_ID = "mobile-host";

/**
 * No-op `IHostQueryInvalidator`. `HostClient` requires an invalidator (it calls
 * `invalidateHostScope` on every bind / context change), but mobile has no
 * TanStack cache to drop yet — so this is a real, type-correct no-op rather than
 * an `any`. `cancelHostScope` is optional and omitted (no observers to cancel).
 */
const NOOP_INVALIDATOR: IHostQueryInvalidator = {
  invalidateHostScope(): void {
    // No host-scoped cache on mobile yet; nothing to invalidate.
  },
};

/**
 * Builds the unary `HostClient` for the configured host and threads auth into
 * it. Returns `null` when no host is configured (`HOST_WS_URL` unset) — the
 * caller renders the "set VITE_HOST_WS_URL" prompt rather than binding a host
 * that can never be dialed.
 */
export function createHostConnection(
  auth: HostConnectionAuth,
  deps: HostConnectionDeps = {},
): HostConnection | null {
  // Explicit-null must survive: `deps.hostWsUrl = null` means "no host", so only
  // an absent field falls back to config (a `??` would swallow the null).
  const hostWsUrl =
    deps.hostWsUrl === undefined ? HOST_WS_URL : deps.hostWsUrl;
  if (hostWsUrl === null) {
    return null;
  }

  const rawMessenger = (deps.messengerFactory ?? defaultMessengerFactory)({
    registry: hostRpcRegistry,
  });

  // Retry OUTSIDE auth-aware (gui-app order): the auth wrapper acts only on
  // UNAUTHORIZED, the retry wrapper only on pre-send RetryableTransportError, so
  // the two never contend and an auth-driven retry sits under one retry budget.
  const messenger = createRetryingMessenger<HostRpcRegistry>(
    createAuthAwareMessenger<HostRpcRegistry>(rawMessenger, auth),
    DEFAULT_TRANSPORT_RETRY_POLICY,
  );

  const hostClient = new HostClient<HostRpcRegistry>({
    registry: hostRpcRegistry,
    messenger,
    invalidator: NOOP_INVALIDATOR,
    // authorityRegistry / requestCoordinator / findHostById default (omit) —
    // mobile owns a single client, so the client-owned defaults are correct.
  });

  const entry: HostDirectoryEntry = {
    hostId: MOBILE_HOST_ID,
    label: "mobile-host",
    kind: "local",
    websocketUrl: hostWsUrl,
    version: null,
    status: "available",
  };

  hostClient.bind(entry);
  hostClient.setRequestContext(auth.current());

  // Re-thread the context on every identity transition (sign-in / sign-out /
  // cross-user). `null` (signed out) flows straight through — `setRequestContext`
  // treats it as an auth-changed transition and RPCs preflight-reject again.
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
