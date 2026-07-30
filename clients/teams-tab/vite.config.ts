import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Standalone Vite app for the Teams static tab. Deliberately NOT a variant of
 * the mobile build: no PWA, no service worker, no offline precache — a Teams
 * tab is loaded fresh by the host and installability is meaningless inside it.
 */
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": resolve(import.meta.dirname, "src") } },
});
