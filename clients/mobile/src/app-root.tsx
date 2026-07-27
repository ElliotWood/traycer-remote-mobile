/**
 * Composition root (T4): builds the app-lifetime services once and provides
 * them to the gate.
 *
 *   - `MobileAuthService` (T1) over the configured AuthnV3 base URL. `start()`
 *     rehydrates a persisted session on load (once — a ref guards React 18
 *     StrictMode's double-invoke of the effect).
 *   - `createHostConnection(auth)` (T2) — the bound unary `HostClient`, or
 *     `null` when no host is configured (`HOST_WS_URL` unset). The gate renders
 *     the config prompt in the `null` case.
 *   - a TanStack `QueryClient` for the fleet's paginated `epic.listTasks`.
 *
 * These are singletons for the app's lifetime, so the connection is
 * deliberately not disposed on unmount: `AppRoot` only unmounts on full page
 * teardown (which the browser reclaims), and disposing in an effect cleanup
 * would wrongly tear the connection down under StrictMode's simulated remount.
 */
import { useEffect, useRef, useState, type ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AUTHN_BASE_URL } from "@/config";
import { MobileAuthService } from "@/host/auth-service";
import { createHostConnection } from "@/host/connection";
import { HostClientProvider } from "@/host/host-client-context";
import { HostStreamConnection } from "@/host/stream-connection";
import { StreamConnectionProvider } from "@/host/stream-connection-context";
import { App } from "@/App";

export function AppRoot(): ReactElement {
  const [auth] = useState(
    () =>
      new MobileAuthService({
        authnBaseUrl: AUTHN_BASE_URL,
        // Production authn only allows client_id `cli`/`desktop` (probed
        // 2026-07-26: `client_id:"mobile"` → 400 "must be 'cli' or 'desktop'").
        // Send `desktop` so the RFC 8628 flow is accepted; `hostLabel` still
        // reads "Traycer Remote (mobile)", so device management still shows this
        // as a mobile device. Revert to `"mobile"` once the backend allowlists
        // it (see decisions artifact).
        // ponytail: masquerade as `desktop` until authn accepts `client_id:"mobile"`.
        clientId: "desktop",
      }),
  );
  const [queryClient] = useState(() => new QueryClient());
  const [connection] = useState(() => createHostConnection(auth));
  // T5 stands up the streaming stack (T3) the unary wiring never reached: one
  // `HostStreamConnection` for the session's `epic.subscribe` / `chat.subscribe`
  // streams, off the SAME auth. Gated on a configured host (like `connection`)
  // and app-lifetime — not disposed on unmount, for the reason above.
  const [streamConnection] = useState(() =>
    connection === null ? null : new HostStreamConnection(auth),
  );

  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void auth.start();
  }, [auth]);

  return (
    <QueryClientProvider client={queryClient}>
      <HostClientProvider client={connection?.hostClient ?? null}>
        <StreamConnectionProvider connection={streamConnection}>
          <App auth={auth} />
        </StreamConnectionProvider>
      </HostClientProvider>
    </QueryClientProvider>
  );
}
