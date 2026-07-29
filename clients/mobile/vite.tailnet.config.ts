// THROWAWAY interim tailnet-test config — DO NOT COMMIT.
// Standalone (no mergeConfig) so all three proxies are unambiguously present:
// binds ONLY the Tailscale interface and proxies /authn (HTTP) + /rpc + /stream
// (WebSocket) so a phone on the tailnet loads app + authn + host WS from ONE
// origin (what the D4 host will eventually do). Mirrors vite.config.ts aliases.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { assetsNotFoundPlugin } from "./vite/assets-not-found-plugin";
import { collectEntryCriticalUrls } from "./vite/collect-entry-critical-urls";

// Bind loopback; `tailscale serve` fronts this over real HTTPS at your
// tailnet's own magic-DNS hostname (<device>.<tailnet-id>.ts.net) - secure
// context, so SW/notifications/PWA work. No hostname is hardcoded anywhere
// in this file (verified - allowedHosts is a bare `true`, not a list), so
// there is nothing to parameterize: this was a machine name in a comment,
// not a config value anything reads.
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
    assetsNotFoundPlugin(),
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
        // MUST stay identical to `vite.config.ts`'s icon list — this config
        // carries its own copy of the manifest, so a change made in only one
        // place ships a tailnet build that silently differs from production.
        // See that file for why both `any` and `maskable` are needed.
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          {
            src: "icons/icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      injectManifest: {
        globPatterns: [
          "index.html",
          "assets/index-*.js",
          "manifest.webmanifest",
          "icons/*.png",
        ],
        // Staleness incident (2026-07-28): mirrors vite.config.ts's fix — see
        // `vite/collect-entry-critical-urls.ts`'s docblock.
        manifestTransforms: [
          async (entries) => {
            const html = readFileSync(resolve(__dirname, "dist", "index.html"), "utf8");
            const required = collectEntryCriticalUrls(html);
            const known = new Set(entries.map((entry) => entry.url));
            const added: string[] = [];
            for (const url of required) {
              if (known.has(url)) continue;
              entries.push({ url, revision: null });
              added.push(url);
            }
            if (added.length > 0) {
              // eslint-disable-next-line no-console
              console.log(`[pwa] precached ${added.length} entry-critical asset(s) globPatterns missed: ${added.join(", ")}`);
            }
            return { manifest: entries, warnings: [] };
          },
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
