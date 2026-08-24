import { defineConfig } from "vitest/config";
import path from "node:path";

// Standalone vitest config, mirroring clients/traycer-cli's. Tests live under
// `src/**/__tests__/`. vitest does not read tsconfig paths, so workspace
// imports are resolved here.
export default defineConfig({
  resolve: {
    alias: [
      {
        find: "@traycer/remote",
        replacement: path.resolve(__dirname, "./src"),
      },
      {
        find: "@traycer-clients/shared",
        replacement: path.resolve(__dirname, "..", "shared"),
      },
      {
        find: /^@traycer\/protocol\/utils\/(.*)$/,
        replacement: path.resolve(
          __dirname,
          "..",
          "..",
          "protocol",
          "utils",
          "$1",
        ),
      },
      {
        find: /^@traycer\/protocol\/(.*)$/,
        replacement: path.resolve(
          __dirname,
          "..",
          "..",
          "protocol",
          "src",
          "$1",
        ),
      },
    ],
  },
  test: {
    include: ["src/**/__tests__/**/*.test.ts"],
    globals: false,
  },
});
