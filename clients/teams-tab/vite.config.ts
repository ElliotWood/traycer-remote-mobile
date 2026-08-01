import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Standalone Vite app for the Teams static tab. Deliberately NOT a variant of
 * the mobile build: no PWA, no service worker, no offline precache — a Teams
 * tab is loaded fresh by the host and installability is meaningless inside it.
 */
export default defineConfig({
  /**
   * The prefix the tab is served under, and the SAME FACT as `BASE` in
   * `src/router/route.ts`. Recorded here rather than typed on the command
   * line, which is where it lived until now:
   *
   *   - `deploy/vm-serve-tab.sh` installs `location /tab/` with an alias, so
   *     nginx serves the app from `/tab/`;
   *   - `route.ts` emits every path under `/tab`;
   *   - but `"build": "vite build"` defaulted to `/`, so the bundle it
   *     produced referenced `/assets/…`, which under that nginx falls through
   *     to the PWA's `location /` and never loads.
   *
   * A deployable artifact therefore required an undocumented `--base=/tab/`
   * that nothing in the repo recorded — the failure the `BASE` docblock warns
   * about, arriving through the build rather than through the router.
   * `src/router/__tests__/base-drift.test.ts` pins the three together.
   *
   * The CLI flag still overrides this, which is what `tools/shoot-tab.mjs`
   * relies on when it builds with `--base=/` to screenshot from a root server.
   */
  base: "/tab/",
  plugins: [react()],
  resolve: { alias: { "@": resolve(import.meta.dirname, "src") } },
});
