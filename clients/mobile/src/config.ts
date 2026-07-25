// The Traycer host endpoint the phone client dials.
//
// D1 points this at a local host (`ws://127.0.0.1:<port>/rpc`). In D4 it becomes
// a tailnet URL (`wss://<machine>.<tailnet>.ts.net/rpc`) exposed via
// `tailscale serve` — the client code does not change, only this value does.
const raw: unknown = import.meta.env.VITE_HOST_WS_URL;

export const HOST_WS_URL: string | null =
  typeof raw === "string" && raw.length > 0 ? raw : null;
