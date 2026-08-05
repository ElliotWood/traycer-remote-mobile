import { defineConfig } from "vitest/config";
import path from "node:path";

// Standalone vitest config for the push-service workspace, mirroring
// clients/traycer-cli's: vitest does not read tsconfig paths, so the
// workspace imports are resolved here.
export default defineConfig({
  resolve: {
    alias: [
      {
        find: "@traycer-clients/mobile-push-service",
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
