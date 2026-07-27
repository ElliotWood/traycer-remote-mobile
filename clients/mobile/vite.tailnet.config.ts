// THROWAWAY interim tailnet-test config — DO NOT COMMIT.
// Standalone (no mergeConfig) so all three proxies are unambiguously present:
// binds ONLY the Tailscale interface and proxies /authn (HTTP) + /rpc + /stream
// (WebSocket) so a phone on the tailnet loads app + authn + host WS from ONE
// origin (what the D4 host will eventually do). Mirrors vite.config.ts aliases.
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const TAILSCALE_IP = "100.110.27.82";
const HOST_WS = "ws://127.0.0.1:55945"; // loopback host, proxied below

export default defineConfig({
  // Mirror S5's VitePWA from the main vite.config.ts so the app's
  // `virtual:pwa-register/react` import (VersionPromptBanner) resolves here too;
  // `devOptions.enabled:false` keeps the SW OFF in this dev serve (no dev SW
  // caching) while still providing the virtual module — full PWA install/offline
  // comes from a production build.
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      registerType: "prompt",
      injectRegister: false,
      devOptions: { enabled: false },
      manifest: {
        name: "Traycer Remote",
        short_name: "Traycer Remote",
        description: "Read chats, browse artifacts, and reply from your phone.",
        start_url: "/",
        display: "standalone",
        background_color: "#111111",
        theme_color: "#111111",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
        ],
      },
      injectManifest: {
        globPatterns: [
          "index.html",
          "assets/index-*.js",
          "manifest.webmanifest",
          "icons/*.png",
        ],
      },
    }),
  ],
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
