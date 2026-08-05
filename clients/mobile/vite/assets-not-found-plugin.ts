import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Plugin } from "vite";

/**
 * Staleness incident (2026-07-28): the preview server's SPA history fallback
 * serves `index.html` (200, text/html) for ANY unmatched request — including
 * a missing `/assets/*` file. A stale lazy-chunk reference (exactly what a
 * rebuild produces once old hashed files are deleted) then gets HTML back
 * where the browser expected a JS module, and `import()` fails on a
 * MIME/parse error instead of a clean, recoverable 404. This plugin 404s a
 * genuinely-missing `/assets/*` request before the SPA fallback middleware
 * ever sees it, so a stale chunk fails the way `ErrorBoundary`'s
 * chunk-load-failure fallback (`error-boundary.tsx`) expects.
 */
export function assetsNotFoundPlugin(): Plugin {
  let outDir = "dist";
  return {
    name: "traycer-assets-not-found",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? "";
        if (!url.startsWith("/assets/")) {
          next();
          return;
        }
        const filePath = join(outDir, url.split("?")[0].split("#")[0]);
        if (existsSync(filePath)) {
          next();
          return;
        }
        res.statusCode = 404;
        res.setHeader("content-type", "text/plain");
        res.end("Not found");
      });
    },
  };
}
