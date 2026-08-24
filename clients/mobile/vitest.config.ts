import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@traycer-clients/shared": path.resolve(__dirname, "../shared"),
      "@traycer-clients/gui-app": path.resolve(__dirname, "../gui-app"),
      "@traycer-clients/mobile": path.resolve(__dirname, "./src"),
      // `@traycer/protocol` is NOT linked into node_modules in this checkout,
      // so its `exports` map never gets consulted and every subpath import
      // fails to resolve. `vite.config.web.ts` already carries the `/utils`
      // half of this for the same reason. Without these two, the whole of
      // `__tests__/mobile-runner-host.test.ts` fails to transform and reports
      // as `(0 test)` - a suite that looks skipped rather than broken.
      // `/utils` must come FIRST: aliases match by prefix, in order, and
      // `utils/` lives beside `src/` rather than under it.
      "@traycer/protocol/utils": path.resolve(
        __dirname,
        "../../protocol/utils",
      ),
      "@traycer/protocol": path.resolve(__dirname, "../../protocol/src"),
      // `sonner` is declared by `gui-app` alone and bun does not hoist it, so a
      // gui-app module imported from a test in THIS package resolves it out of
      // `clients/gui-app/node_modules` while `vi.mock("sonner")` here resolves
      // nothing at all. The failure is silent in the worst way: the mock
      // registers, never binds, and the spy simply reports zero calls - which
      // reads exactly like "the code never toasted" rather than "the
      // instrument was never connected". Pinning both sides to one path is
      // what makes a toast assertion from this package mean anything.
      //
      // This encodes bun's per-package layout, which is what this repo installs
      // with. Under a hoisting installer the path is simply absent and the
      // import fails loudly at collection - the one failure mode worth having
      // here, given the bug being avoided is a silent zero.
      sonner: path.resolve(__dirname, "../gui-app/node_modules/sonner"),
      "@": path.resolve(__dirname, "../gui-app/src"),
    },
  },
  test: {
    environment: "jsdom",
    include: [
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      "__tests__/**/*.test.ts",
      "__tests__/**/*.test.tsx",
    ],
    globals: false,
  },
});
