import path from "node:path";
import { defineConfig } from "vitest/config";

// Mirrors gui-app's alias set so `@`, `@traycer-clients/shared`, and
// `@traycer/protocol` resolve the same way under test as under Vite/tsc.
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
    environment: "node",
  },
});
