// Runtime configuration for the phone client, read from Vite env vars.
//
// D1 supplies these on the dev machine to connect to a local host:
//   VITE_HOST_WS_URL     ws://127.0.0.1:<port>/rpc
//   VITE_HOST_BEARER     device-flow bearer token
//   VITE_HOST_USER_ID    the signed-in user id
// In D4 the URL becomes a tailnet wss:// address — nothing else changes.
// A device-flow sign-in UI can replace the bearer/user env vars later; the
// plain-bearer path mirrors how the Traycer CLI reads its credentials.

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export const HOST_WS_URL: string | null = readString(
  import.meta.env.VITE_HOST_WS_URL,
);
export const HOST_BEARER_TOKEN: string | null = readString(
  import.meta.env.VITE_HOST_BEARER,
);
export const HOST_USER_ID: string | null = readString(
  import.meta.env.VITE_HOST_USER_ID,
);
