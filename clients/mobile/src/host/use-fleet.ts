import { useEffect, useState } from "react";
import { HOST_BEARER_TOKEN, HOST_USER_ID, HOST_WS_URL } from "@/config";
import { createHostConnection } from "@/host/connection";
import { listFleet, type FleetItem } from "@/host/fleet";

export type FleetState =
  | { readonly kind: "unconfigured" }
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "ready"; readonly items: readonly FleetItem[] };

function isConfigured(): boolean {
  return (
    HOST_WS_URL !== null &&
    HOST_BEARER_TOKEN !== null &&
    HOST_USER_ID !== null
  );
}

/**
 * Loads the fleet from the real host once on mount. No mock data — when the
 * config is absent it reports `unconfigured`; otherwise it dials the real
 * `epic.listTasks`.
 */
export function useFleet(): FleetState {
  const [state, setState] = useState<FleetState>(
    isConfigured() ? { kind: "loading" } : { kind: "unconfigured" },
  );

  useEffect(() => {
    if (
      HOST_WS_URL === null ||
      HOST_BEARER_TOKEN === null ||
      HOST_USER_ID === null
    ) {
      return;
    }
    const controller = new AbortController();
    const connection = createHostConnection({
      websocketUrl: HOST_WS_URL,
      bearerToken: HOST_BEARER_TOKEN,
      userId: HOST_USER_ID,
    });
    setState({ kind: "loading" });
    listFleet(connection, controller.signal).then(
      (items) => {
        if (!controller.signal.aborted) {
          setState({ kind: "ready", items });
        }
      },
      (error: unknown) => {
        if (!controller.signal.aborted) {
          setState({
            kind: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      },
    );
    return () => {
      controller.abort();
    };
  }, []);

  return state;
}
