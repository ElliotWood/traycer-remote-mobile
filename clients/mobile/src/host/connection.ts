/**
 * Mobile's single-host connection: the shared stack, with mobile's config.
 *
 * The wiring itself now lives in
 * `@traycer-clients/shared/host-client/single-host-connection` — it was MOVED
 * there when the Teams tab needed the identical stack, not copied. The
 * layering (retry outside auth-aware; `bind` + `setRequestContext` before any
 * RPC is reachable) is subtle enough that two divergent copies of it is a
 * guaranteed future bug.
 *
 * What remains here is the part that is genuinely mobile's: which URL and
 * which host id, read from mobile's own `@/config`.
 */
import {
  createSingleHostConnection,
  type HostConnection,
  type HostConnectionAuth,
  type MessengerFactory,
} from "@traycer-clients/shared/host-client/single-host-connection";
import { CONFIGURED_HOST_ID, HOST_WS_URL } from "@/config";

export type { HostConnection, HostConnectionAuth, MessengerFactory };

/**
 * Local UI label for the single mobile-configured host connection — what the
 * bound `HostDirectoryEntry` keys on. NOT the host's real, durable id
 * (`chatSchema.hostId`): that value is a server-recognized identity the wire
 * protocol never exposes to a fresh client, so it cannot be derived from this
 * label. Where a durable binding is actually needed (`epic.createChat`'s
 * `hostId`, `use-create-chat.ts`), this is only the FALLBACK when no real id
 * has been configured via `VITE_HOST_ID` (`CONFIGURED_HOST_ID`).
 */
export const MOBILE_HOST_ID = "mobile-host";

/**
 * H2: is `hostId` (a chat's durable binding, `EpicChatEntry.hostId`) a
 * DIFFERENT host than the one this connection is dialed into? A `null` hostId
 * (not yet replicated) is treated as "unknown, assume local" rather than
 * foreign — avoids a false-positive flash on a chat whose epic-doc entry
 * hasn't synced yet. Only meaningful once a real `VITE_HOST_ID` is configured;
 * without one every chat this client itself creates is ALSO stamped with the
 * `MOBILE_HOST_ID` fallback, so it reads as local even when it may not durably
 * be — a known limitation of running without the real id, not a bug here.
 */
export function isForeignHostChat(hostId: string | null): boolean {
  if (hostId === null) return false;
  return hostId !== (CONFIGURED_HOST_ID ?? MOBILE_HOST_ID);
}

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

export function createHostConnection(
  auth: HostConnectionAuth,
  deps: HostConnectionDeps = {},
): HostConnection | null {
  // Explicit-null must survive: `deps.hostWsUrl = null` means "no host", so
  // only an ABSENT field falls back to config (a `??` would swallow the null).
  const hostWsUrl =
    deps.hostWsUrl === undefined ? HOST_WS_URL : deps.hostWsUrl;
  return createSingleHostConnection(auth, {
    hostWsUrl,
    localHostId: MOBILE_HOST_ID,
    messengerFactory: deps.messengerFactory,
  });
}
