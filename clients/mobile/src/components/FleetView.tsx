import type { ReactElement } from "react";
import { useFleet } from "@/host/use-fleet";

// Renders the real fleet from the host. The blocked-agent detail + reply views
// (D2) build on this list.
export function FleetView(): ReactElement {
  const state = useFleet();

  switch (state.kind) {
    case "unconfigured":
      return (
        <p>
          Set <code>VITE_HOST_WS_URL</code>, <code>VITE_HOST_BEARER</code>, and{" "}
          <code>VITE_HOST_USER_ID</code>, then reload.
        </p>
      );
    case "loading":
      return <p>Loading fleet…</p>;
    case "error":
      return <p role="alert">Couldn’t load fleet: {state.message}</p>;
    case "ready":
      if (state.items.length === 0) {
        return <p>No agents yet.</p>;
      }
      return (
        <ul>
          {state.items.map((item) => (
            <li key={`${item.kind}:${item.id}`}>
              <strong>{item.title}</strong> — {item.status}{" "}
              <code>{item.id}</code>
            </li>
          ))}
        </ul>
      );
  }
}
