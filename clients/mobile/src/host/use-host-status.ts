/** `host.status` — host/protocol version for the Settings → About section. */
import { useEffect, useState } from "react";
import type { MobileHostClient } from "./host-client-context";

export interface HostStatus {
  readonly ready: boolean;
  readonly hostVersion: string;
  readonly protocolVersion: { readonly major: number; readonly minor: number };
}

export function useHostStatus(client: MobileHostClient | null): { readonly status: HostStatus | null } {
  const [status, setStatus] = useState<HostStatus | null>(null);

  useEffect(() => {
    if (client === null) return;
    let cancelled = false;
    void client
      .request("host.status", {})
      .then((response) => {
        if (!cancelled) setStatus(response);
      })
      .catch(() => {
        // Leaves `status` null — the About section simply omits the version line.
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  return { status };
}
