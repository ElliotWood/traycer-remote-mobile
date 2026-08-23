/**
 * BROWSER-PROOF BUILD ONLY - not shipped, not upstreamed.
 *
 * The shipped `vite.config.ts` is a DEV-SERVER config: it demands
 * DEV_DESKTOP_SLOT / PORT / TRAYCER_DEV_* and reads a local `pid.json` off
 * the machine's home directory to discover a 127.0.0.1 host. That makes
 * `bun run build:web` unrunnable against anything but a local `make
 * dev-desktop` stack.
 *
 * This config is the same build with the host baked from env instead:
 *   - `kind: "local"` pointing at a REMOTE wss:// url. That is not a
 *     contradiction - `local` means "dial `websocketUrl` directly", which is
 *     exactly what an nginx-fronted host over WSS is. `remote` means the
 *     relay + Noise-NK path, which needs a registry-published public key we
 *     deliberately are not exercising here.
 *   - `base` set HERE, never via `--base` on the CLI: MSYS/Git Bash rewrites
 *     a leading-slash flag value into a Windows path and silently blanks the
 *     deployed app.
 *   - the two Capacitor imports aliased to a localStorage/window.open shim
 *     so the bundle has no native dependency.
 */
import { resolve } from "node:path";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig, type Plugin, type UserConfig } from "vite";

/**
 * Emits `manifest.webmanifest` and links it from the document.
 *
 * IN THE CONFIG BECAUSE ONLY THE CONFIG KNOWS `base`. `start_url` and `scope`
 * have to be the deployment path - a manifest claiming `/` at a build served
 * from `/next/` installs an app whose icon opens the wrong page, and the two
 * other surfaces on this origin (`/` and `/tab/`) make that a live collision
 * rather than a theoretical one. A static file in `public/` cannot express it.
 *
 * The `<link>` tags are injected rather than written into `index.html` so the
 * source document does not reference a file that exists only after a build.
 */
function webManifestPlugin(base: string): Plugin {
  const manifest = {
    name: "Traycer Remote",
    short_name: "Traycer",
    description: "Watch your fleet and answer blocked agents from your phone.",
    start_url: base,
    scope: base,
    display: "standalone",
    background_color: "#111111",
    theme_color: "#111111",
    icons: [
      { src: `${base}icons/icon-192.png`, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: `${base}icons/icon-512.png`, sizes: "512x512", type: "image/png", purpose: "any" },
      // `any` AND `maskable` are both required. Android applies its own
      // adaptive-icon mask and, given only `any` icons, crops the artwork to
      // fit - clipping the logo's edges. The maskable variant is the same
      // artwork inset into a 14% safe zone. Keep the `any` entries too:
      // maskable alone renders padded and undersized wherever nothing masks.
      {
        src: `${base}icons/icon-maskable-512.png`,
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };

  return {
    name: "traycer-web-manifest",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "manifest.webmanifest",
        source: JSON.stringify(manifest, null, 2),
      });
    },
    transformIndexHtml: {
      order: "post",
      handler() {
        return [
          {
            tag: "link",
            attrs: { rel: "manifest", href: `${base}manifest.webmanifest` },
            injectTo: "head" as const,
          },
          {
            tag: "link",
            attrs: { rel: "apple-touch-icon", href: `${base}icons/apple-touch-icon.png` },
            injectTo: "head" as const,
          },
          {
            tag: "meta",
            attrs: { name: "theme-color", content: manifest.theme_color },
            injectTo: "head" as const,
          },
        ];
      },
    },
  };
}

const mobileRoot = __dirname;
const clientsRoot = resolve(mobileRoot, "..");
const guiAppRoot = resolve(clientsRoot, "gui-app");
const sharedRoot = resolve(clientsRoot, "shared");
const protocolRoot = resolve(clientsRoot, "..", "protocol");
const capacitorShim = resolve(mobileRoot, "src", "web", "capacitor-web-shim.ts");

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} is required for the web build`);
  }
  return value.trim();
}

export default defineConfig((): UserConfig => {
  const origin = requiredEnv("TRAYCER_WEB_ORIGIN");
  // Trailing slash guaranteed here, once, because everything downstream
  // concatenates onto it: the manifest's `scope`/`start_url`/icon paths and
  // the service worker's precache list. `/next` without it silently yields
  // `/nexticons/icon-192.png` - a 404 that takes the whole atomic precache
  // down with it, reported as "the worker did not install".
  const rawBase = requiredEnv("TRAYCER_WEB_BASE");
  const base = rawBase.endsWith("/") ? rawBase : `${rawBase}/`;
  const devConfig = {
    authnBaseUrl: `${origin}/authn`,
    signInUrl: "https://traycer.ai/sign-in",
    relayBaseUrl: "wss://relay.traycer.ai/attach",
    // No dev-server middleware in a static build, so this fetch always
    // fails and `main.tsx` falls back to the baked entry below - which is
    // the entry we actually want.
    devHostPath: "/__traycer/dev-host",
    host: {
      hostId: requiredEnv("TRAYCER_WEB_HOST_ID"),
      label: requiredEnv("TRAYCER_WEB_HOST_LABEL"),
      kind: "local" as const,
      websocketUrl: requiredEnv("TRAYCER_WEB_HOST_WS_URL"),
      version: requiredEnv("TRAYCER_WEB_HOST_VERSION"),
      status: "available" as const,
    },
  };

  return {
    root: resolve(mobileRoot, "src", "web"),
    base,
    define: {
      __TRAYCER_GUI_APP_DEV_CONFIG__: JSON.stringify(devConfig),
    },
    plugins: [
      tanstackRouter({
        enableRouteGeneration: false,
        target: "react",
        quoteStyle: "double",
        semicolons: true,
        autoCodeSplitting: true,
        routeFileIgnorePattern: "__tests__|route-components|route-search",
        routesDirectory: resolve(guiAppRoot, "src", "routes"),
        generatedRouteTree: resolve(guiAppRoot, "src", "routeTree.gen.ts"),
      }),
      react(),
      tailwindcss(),
      babel({ presets: [reactCompilerPreset()] }).then((plugin) => ({
        ...plugin,
        enforce: "post" as const,
      })),
      webManifestPlugin(base),
    ],
    resolve: {
      alias: {
        "@capacitor/browser": capacitorShim,
        "capacitor-secure-storage-plugin": capacitorShim,
        "@traycer/protocol/utils": resolve(protocolRoot, "utils"),
        "@traycer/protocol": resolve(protocolRoot, "src"),
        "@traycer-clients/gui-app": guiAppRoot,
        "@traycer-clients/shared": sharedRoot,
        "@": resolve(guiAppRoot, "src"),
      },
    },
    build: {
      target: "es2022",
      emptyOutDir: true,
      outDir: resolve(mobileRoot, "dist", "web"),
      sourcemap: process.env.TRAYCER_WEB_SOURCEMAP === "1",
    },
  };
});
