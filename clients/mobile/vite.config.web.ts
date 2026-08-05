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
import { defineConfig, type UserConfig } from "vite";

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
  const base = requiredEnv("TRAYCER_WEB_BASE");
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
