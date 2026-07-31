import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

/**
 * Workspace aliases are mirrored here because Vitest does not read the
 * tsconfig `paths`, and because `clients/shared` imports `@traycer/protocol/*`
 * without declaring it as a dependency — so bare-specifier resolution from a
 * file inside `clients/shared` walks up to a `node_modules` that has no
 * `@traycer` in it and fails. `clients/mobile/vitest.config.ts` carries the
 * same block for the same reason; this is that precedent, not a new mechanism.
 *
 * Without these, any test that reaches the host stack (`src/host/connection`
 * and everything under it) fails to import rather than failing to pass —
 * which reads as "untestable" and is really "unresolved".
 */
export default defineConfig({
  resolve: {
    alias: [
      { find: "@", replacement: resolve(import.meta.dirname, "src") },
      {
        find: "@traycer-clients/shared",
        replacement: resolve(import.meta.dirname, "..", "shared"),
      },
      {
        find: /^@traycer\/protocol\/utils\/(.*)$/,
        replacement: resolve(import.meta.dirname, "..", "..", "protocol", "utils", "$1"),
      },
      {
        find: /^@traycer\/protocol\/(.*)$/,
        replacement: resolve(import.meta.dirname, "..", "..", "protocol", "src", "$1"),
      },
    ],
  },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
