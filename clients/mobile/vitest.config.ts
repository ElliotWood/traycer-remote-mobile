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
export default defineConfig({
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
    include: ["src/**/__tests__/**/*.test.ts", "src/**/__tests__/**/*.test.tsx"],
    globals: false,
  },
});
