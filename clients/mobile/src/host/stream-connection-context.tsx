/**
 * React context carrying the single mobile `HostStreamConnection` (T5).
 *
 * T3 built `HostStreamConnection` (the one `WsStreamClient` per signed-in
 * session, off which every `epic.subscribe` / `chat.subscribe` opens) but never
 * wired it into the app — `AppRoot` only stood up the unary `HostClient`. T5 is
 * the first streamed view (epic detail), so it instantiates the stream
 * connection at the composition root and threads it here, mirroring
 * `HostClientProvider`.
 *
 * `null` means no host is configured (`HOST_WS_URL` unset) — the gate never
 * reaches a streamed view in that case, but the context value is nullable to
 * model the unconfigured state honestly, and the epic view degrades to a
 * "disconnected" surface rather than dialing a host that cannot exist.
 */
import { createContext, useContext, type ReactElement, type ReactNode } from "react";
import type { HostStreamConnection } from "./stream-connection";

const StreamConnectionContext = createContext<HostStreamConnection | null>(null);

export function StreamConnectionProvider({
  connection,
  children,
}: {
  readonly connection: HostStreamConnection | null;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <StreamConnectionContext.Provider value={connection}>
      {children}
    </StreamConnectionContext.Provider>
  );
}

export function useStreamConnectionOrNull(): HostStreamConnection | null {
  return useContext(StreamConnectionContext);
}
