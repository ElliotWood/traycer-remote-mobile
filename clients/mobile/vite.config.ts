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
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5273,
  },
});
