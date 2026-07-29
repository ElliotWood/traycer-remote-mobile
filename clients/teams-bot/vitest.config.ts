import { defineConfig } from "vitest/config";
import path from "node:path";

// Standalone vitest config, mirroring clients/mobile-push-service: vitest does
// not read tsconfig paths, so the workspace-local alias is resolved here.
export default defineConfig({
  resolve: {
    alias: [
      {
        find: "@traycer-clients/teams-bot",
        replacement: path.resolve(__dirname, "./src"),
      },
    ],
  },
  test: {
    include: ["src/**/__tests__/**/*.test.ts"],
    globals: false,
  },
});
