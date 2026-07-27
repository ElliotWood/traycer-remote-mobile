// The Traycer host endpoint the phone client dials.
//
// D1 points this at a local host (`ws://127.0.0.1:<port>/rpc`). In D4 it becomes
// a tailnet URL (`wss://<machine>.<tailnet>.ts.net/rpc`) exposed via
// `tailscale serve` — the client code does not change, only this value does.
const raw: unknown = import.meta.env.VITE_HOST_WS_URL;

export const HOST_WS_URL: string | null =
  typeof raw === "string" && raw.length > 0 ? raw : null;

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
