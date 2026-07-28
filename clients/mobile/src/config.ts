// The Traycer host endpoint the phone client dials.
//
// D1 points this at a local host (`ws://127.0.0.1:<port>/rpc`). In D4 it becomes
// a tailnet URL (`wss://<machine>.<tailnet>.ts.net/rpc`) exposed via
// `tailscale serve` — the client code does not change, only this value does.
const raw: unknown = import.meta.env.VITE_HOST_WS_URL;

export const HOST_WS_URL: string | null =
  typeof raw === "string" && raw.length > 0 ? raw : null;

// H1: the host's REAL, durable id (from the external host's own `pid.json`,
// e.g. via the dev rig's `tcp-host-proxy.mjs`) — NOT discoverable over the WS
// wire protocol itself (checked: no handshake field, no bootstrap-safe RPC;
// see the H1 finding). `null` when unset, in which case
// `use-create-chat.ts` falls back to the synthetic `MOBILE_HOST_ID` label
// (a real protocol gap, not something this client can paper over on its
// own — a chat created that way will render as an unreachable host on
// desktop until the value is supplied here).
const rawHostId: unknown = import.meta.env.VITE_HOST_ID;

export const CONFIGURED_HOST_ID: string | null =
  typeof rawHostId === "string" && rawHostId.length > 0 ? rawHostId : null;

// AuthnV3 base URL the device-flow + whoami/refresh calls hit. Production
// authn lives at `https://authn.traycer.ai` (the same value the CLI/desktop
// builds bake into their config); a dev backend can be pointed at a local
// AuthnV3 via `VITE_AUTHN_BASE_URL`. Unlike the CLI's flat config this is a
// browser build, so the override rides Vite's `import.meta.env` rather than
// `process.env`.
const rawAuthn: unknown = import.meta.env.VITE_AUTHN_BASE_URL;

export const AUTHN_BASE_URL: string =
  typeof rawAuthn === "string" && rawAuthn.length > 0
    ? rawAuthn
    : "https://authn.traycer.ai";
