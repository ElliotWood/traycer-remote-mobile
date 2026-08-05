/**
 * React context carrying the single mobile `HostClient` (T4).
 *
 * The client is built once at the composition root (`AppRoot`) from
 * `createHostConnection(auth)` and threaded down here, so the fleet view and
 * any later RPC-driven view read the same bound client without prop-drilling.
 * `null` means no host is configured (`HOST_WS_URL` unset) — the gate renders
 * the config prompt in that case, so views under the provider can assume a
 * non-null client only when reached, but the context value is nullable to model
 * the unconfigured state honestly.
 */
import { createContext, useContext, type ReactElement, type ReactNode } from "react";
import type { HostClient } from "@traycer-clients/shared/host-client/host-client";
import type { HostRpcRegistry } from "@traycer/protocol/host/index";

export type MobileHostClient = HostClient<HostRpcRegistry>;

const HostClientContext = createContext<MobileHostClient | null>(null);

export function HostClientProvider({
  client,
  children,
}: {
  readonly client: MobileHostClient | null;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <HostClientContext.Provider value={client}>
      {children}
    </HostClientContext.Provider>
  );
}

export function useHostClientOrNull(): MobileHostClient | null {
  return useContext(HostClientContext);
}
