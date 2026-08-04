/**
 * Mobile's `/stream` transport: the shared stack, with mobile's config.
 *
 * The transport itself now lives in
 * `@traycer-clients/shared/host-transport/single-host-stream-connection` —
 * MOVED there when the Teams tab needed the identical stack, not copied, and
 * at the same seam as the unary connection before it. What was mobile-specific
 * was only ever the endpoint (`@/config`) and the concrete auth service; both
 * are parameters now.
 *
 * Everything else is re-exported from here so no call site moved.
 */
import {
  HostStreamConnection as SharedHostStreamConnection,
  DEFAULT_STREAM_HOST_ID,
} from "@traycer-clients/shared/host-transport/single-host-stream-connection";
import { CONFIGURED_HOST_ID, HOST_WS_URL } from "@/config";
import type { MobileAuthService } from "@traycer-clients/shared/auth/browser-device-auth-service";

export {
  StreamConnectionStateStore,
  createStreamAuthRevalidator,
  openChatStream,
  openEpicStream,
  toConnectionState,
  type OpenStreamHandle,
  type StreamConnectionAuth,
  type StreamConnectionState,
} from "@traycer-clients/shared/host-transport/single-host-stream-connection";

/**
 * HA-1 (critique finding 12 — the "third host id"): this used to be
 * `DEFAULT_STREAM_HOST_ID` unconditionally, a hardcoded label unrelated to
 * `CONFIGURED_HOST_ID` — the same shape `MOBILE_HOST_ID` had in `connection.ts`
 * before HA-1. Grep-checked before changing this: `ws-stream-client.ts` and
 * `ws-rpc-client.ts` don't key sessions on `hostId` or put it on the wire
 * today — its only live use is one error-message string
 * (`ws-rpc-client.ts:174`) — so this was forward-hygiene, not an active leak.
 * But `HA-4`'s two-tier connection manager is the thing that WOULD build a
 * per-machine table keyed on this, and a hardcoded constant a later ticket
 * builds on top of stops looking accidental and starts looking load-bearing.
 * So: derive it from the real per-client id when one is configured, falling
 * back to the existing local-only label otherwise — mobile has no host
 * directory (only `HOST_WS_URL` in config), so the stream client reads only
 * `websocketUrl` for dialing; `hostId` remains carried for endpoint identity
 * only, on either branch.
 *
 * A FUNCTION, not a top-level constant: `connection.ts`'s `isForeignHostChat`
 * and `use-create-chat.ts`'s `authoredChatHostId` both read `CONFIGURED_HOST_ID`
 * lazily, inside a function body, for the same reason — a top-level
 * `export const HOST_ID = CONFIGURED_HOST_ID ?? …` reads `@/config` at MODULE
 * IMPORT time. That broke two unrelated test files (`author-view.test.tsx`,
 * `new-epic-view.test.tsx`) that mock `@/config` with a getter backed by a
 * `const` declared after the `vi.mock` call: `test-utils/fakes.ts` imports
 * this module before either file's own `configMock` initializes, hitting the
 * getter mid-TDZ. Caught by running the full suite, not just this file's own
 * tests — verification-practices' "measure the producer" rule extends to a
 * change's blast radius, not only its target.
 */
export function getHostId(): string {
  return CONFIGURED_HOST_ID ?? DEFAULT_STREAM_HOST_ID;
}

/**
 * Owns the single mobile `WsStreamClient` for a signed-in session.
 *
 * Subclassed rather than re-exported so the constructor keeps its
 * one-argument shape: every call site passes just the auth service, and
 * binding the endpoint is exactly the mobile-specific part.
 */
export class HostStreamConnection extends SharedHostStreamConnection {
  constructor(auth: MobileAuthService) {
    super(auth, {
      hostWsUrl: HOST_WS_URL,
      hostId: getHostId(),
    });
  }
}
