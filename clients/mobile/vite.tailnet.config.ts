// THROWAWAY interim tailnet-test config — DO NOT COMMIT.
// Standalone (no mergeConfig) so all three proxies are unambiguously present:
// binds ONLY the Tailscale interface and proxies /authn (HTTP) + /rpc + /stream
// (WebSocket) so a phone on the tailnet loads app + authn + host WS from ONE
// origin (what the D4 host will eventually do). Mirrors vite.config.ts aliases.
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const TAILSCALE_IP = "100.110.27.82";
const HOST_WS = "ws://127.0.0.1:55945"; // loopback host, proxied below

export default defineConfig({
  plugins: [react()],
  envPrefix: ["VITE_"],
  resolve: {
    alias: [
      { find: "@", replacement: resolve(__dirname, "src") },
      { find: "@traycer-clients/shared", replacement: resolve(__dirname, "..", "shared") },
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
    host: TAILSCALE_IP, // bind ONLY the tailnet interface (not LAN/public)
    port: 5273,
    allowedHosts: true,
    proxy: {
      "/authn": {
        target: "https://authn.traycer.ai",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/authn/, ""),
      },
      "/rpc": { target: HOST_WS, ws: true, changeOrigin: true },
      "/stream": { target: HOST_WS, ws: true, changeOrigin: true },
    },
  },
});
