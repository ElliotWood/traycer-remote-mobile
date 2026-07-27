import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// Standalone Vite app for the phone client. `@traycer/protocol` and
// `@traycer-clients/shared` resolve as workspace packages (their exports point
// at TS source, so no build step). The host endpoint is supplied at runtime via
// VITE_HOST_WS_URL (local ws://127.0.0.1:<port>/rpc now; a tailnet wss:// URL in
// D4 — the client code is identical either way).
export default defineConfig({
  plugins: [
    react(),
    // S5 (B): installable PWA + "new version" prompt. `injectManifest` (not
    // `generateSW`) because `src/sw.ts` needs to own the `notificationclick`
    // handler (§C) — a `generateSW`-produced opaque SW couldn't host it, so
    // precaching and the click handler share that one custom file instead.
    // `registerType: "prompt"` — a new SW installs and waits for the page's
    // banner to ask it to activate (`useRegisterSW` in `src/App.tsx`), it
    // never self-activates. `devOptions` stays disabled: the SW does not
    // register under `bun run dev` — PWA/version-prompt/notification behavior
    // is only real under `vite build` + `vite preview` (contract, F2).
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
        // M3: precache the app shell ONLY — index.html, the main JS entry,
        // the generated manifest, and the icons. Left unbounded, Workbox's
        // default glob would sweep in every lazy mermaid/katex/cytoscape
        // diagram chunk (Sprint 1 deliberately kept off the initial route),
        // pulling several MB over the network on SW install regardless of
        // whether the user ever opens a diagram. Those chunks stay
        // runtime-fetch-on-demand — never precached, never intercepted.
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
