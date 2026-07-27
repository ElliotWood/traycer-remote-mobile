import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig } from "vite";

// Standalone Vite app for the phone client. `@traycer/protocol` and
// `@traycer-clients/shared` resolve as workspace packages (their exports point
// at TS source, so no build step). The host endpoint is supplied at runtime via
// VITE_HOST_WS_URL (local ws://127.0.0.1:<port>/rpc now; a tailnet wss:// URL in
// D4 — the client code is identical either way).
export default defineConfig({
  plugins: [react()],
  envPrefix: ["VITE_"],
  resolve: {
    // Workspace aliases. `@traycer/protocol` and `@traycer-clients/shared`
    // resolve to TS source (no build step) — but Vite's browser build does NOT
    // read tsconfig `paths`, and the packages' `exports` subpaths don't resolve
    // through the bun-workspace symlink here, so the bare specifiers must be
    // aliased explicitly or the app white-screens on `Failed to resolve import`.
    // Kept byte-identical to `vitest.config.ts` so dev, prod build, and the test
    // suite resolve the same files. The `@` string alias only matches `@/…`
    // (not `@traycer…`), so ordering with the scoped regexes is safe.
    alias: [
      { find: "@", replacement: resolve(__dirname, "src") },
      {
        find: "@traycer-clients/shared",
        replacement: resolve(__dirname, "..", "shared"),
      },
      {
        find: /^@traycer\/protocol\/utils\/(.*)$/,
        replacement: resolve(__dirname, "..", "..", "protocol", "utils", "$1"),
      },
      {
        find: /^@traycer\/protocol\/(.*)$/,
        replacement: resolve(__dirname, "..", "..", "protocol", "src", "$1"),
      },
    ],
  },
  server: {
    host: "127.0.0.1",
    port: 5273,
    // AuthnV3 only sends `Access-Control-Allow-Origin: https://platform.traycer.ai`,
    // so a browser at any other origin (localhost dev, a D4 tailnet URL) is
    // CORS-blocked from calling it directly. The CLI/desktop avoid this by
    // fetching from Node/Electron-main (no CORS); a browser client cannot. This
    // dev proxy forwards `/authn/*` to authn server-side so the browser makes a
    // same-origin call. Point `VITE_AUTHN_BASE_URL` at `http://127.0.0.1:5273/authn`
    // to use it. NOTE: production (tailnet) needs the equivalent proxy on the
    // host — see the decisions artifact; this is a dev unblock, not the shipped
    // answer.
    proxy: {
      "/authn": {
        target: "https://authn.traycer.ai",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/authn/, ""),
      },
    },
  },
});
