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
import { HOST_WS_URL } from "@/config";
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
 * Endpoint identity for the single fixed host the phone dials. Mobile has no
 * host directory (only `HOST_WS_URL` in config), so this is a stable label —
 * the stream client reads only `websocketUrl` (rewriting `/rpc`→`/stream` via
 * `toStreamDialUrl`); `hostId` is carried for endpoint identity only.
 */
export const HOST_ID = DEFAULT_STREAM_HOST_ID;

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
      hostId: HOST_ID,
    });
  }
}
