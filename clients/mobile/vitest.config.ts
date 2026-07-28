import path from "node:path";
import { defineConfig } from "vitest/config";

// Vitest does not read the tsconfig `paths`, so the workspace aliases are
// mirrored here (matching `clients/shared` + `clients/gui-app`). The suite runs
// in the default `node` environment: the logic tests (auth-service, connection,
// stream, epic-list mapping, gate) inject in-memory fakes and mock `fetch`, so
// they need no DOM. The React render tests (`*.test.tsx`) opt INTO jsdom
// per-file via a `// @vitest-environment jsdom` docblock rather than flipping
// the whole suite — keeping the node-env logic tests untouched. Both `.ts` and
// `.tsx` are collected below.
/**
 * `virtual:pwa-register/react` is only real under `vite-plugin-pwa` (wired
 * into `vite.config.ts`, not this test config — vitest doesn't build a real
 * SW). This stub makes the bare specifier resolvable during Vite's
 * import-analysis transform so `vi.mock("virtual:pwa-register/react", ...)`
 * in `version-prompt-banner.test.tsx` has something to override; the stub's
 * own body is never actually exercised (every test overrides it via
 * `vi.mock`).
 */
const stubPwaRegisterVirtualModule = {
  name: "stub-pwa-register-virtual-module",
  resolveId(id: string) {
    if (id === "virtual:pwa-register/react") return id;
    return undefined;
  },
  load(id: string) {
    if (id === "virtual:pwa-register/react") {
      return `export const useRegisterSW = () => ({
        needRefresh: [false, () => {}],
        offlineReady: [false, () => {}],
        updateServiceWorker: async () => {},
      });`;
    }
    return undefined;
  },
};

export default defineConfig({
  plugins: [stubPwaRegisterVirtualModule],
  resolve: {
    alias: [
      { find: "@", replacement: path.resolve(__dirname, "src") },
      {
        find: "@traycer-clients/shared",
        replacement: path.resolve(__dirname, "..", "shared"),
      },
      {
        find: /^@traycer\/protocol\/utils\/(.*)$/,
        replacement: path.resolve(__dirname, "..", "..", "protocol", "utils", "$1"),
      },
      {
        find: /^@traycer\/protocol\/(.*)$/,
        replacement: path.resolve(__dirname, "..", "..", "protocol", "src", "$1"),
      },
    ],
  },
  test: {
    include: [
      "src/**/__tests__/**/*.test.ts",
      "src/**/__tests__/**/*.test.tsx",
      // Build-time-only helpers (Vite config plugins) live outside `src/`
      // deliberately — they're Node build tooling, not app bundle code — but
      // still get the same test coverage.
      "vite/**/__tests__/**/*.test.ts",
    ],
    globals: false,
    setupFiles: ["./vitest.setup.ts"],
  },
});
