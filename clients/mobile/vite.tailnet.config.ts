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

// Bind loopback; `tailscale serve` fronts this over real HTTPS at
// https://tonberry.tail267a92.ts.net (secure context → SW/notifications/PWA work).
const TAILSCALE_IP = "127.0.0.1";
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
  // Production-build preview, fronted separately by `tailscale serve --https=9443`.
  // WHY THIS EXISTS: `devOptions.enabled:false` above means the service worker
  // does NOT register under the dev server, so PWA install, the version-prompt
  // banner, `clients.claim()` behaviour and push are all untestable on the :443
  // dev origin. Anything touching the SW must be verified against a real
  // production build — this preview is that build, running alongside (not
  // replacing) the dev server so both origins stay available.
  // `/authn` is duplicated here because Vite does not inherit `server.proxy`
  // into preview; without it, sign-in 404s on the preview origin.
  preview: {
    host: TAILSCALE_IP,
    port: 5278,
    allowedHosts: true,
    proxy: {
      "/authn": {
        target: "https://authn.traycer.ai",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/authn/, ""),
      },
    },
  },
});
