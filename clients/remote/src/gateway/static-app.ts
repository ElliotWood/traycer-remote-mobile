import { stat, readFile } from "node:fs/promises";
import { join, extname, normalize, sep } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createPassthroughHandler } from "./passthrough";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

/**
 * True when a path "looks like" a static asset request (has a file
 * extension in its last segment) rather than a client-side route. Used to
 * decide whether a miss 404s or falls back to `index.html` - the SPA
 * fallback trap the Planner flagged: a naive fallback returns `200
 * text/html` for a missing `/assets/*.js`, which turns a clean 404 into an
 * opaque module-parse error in the browser.
 */
function looksLikeAssetPath(path: string): boolean {
  const lastSegment = path.split("/").pop() ?? "";
  return lastSegment.includes(".");
}

async function serveStaticFile(
  staticDirRaw: string,
  reqPath: string,
  res: ServerResponse,
): Promise<boolean> {
  // `staticDir` from config may use forward slashes even on Windows -
  // normalize it once to the OS-native separator so the prefix check below
  // compares like with like against `join()`'s output (which always uses
  // the native separator regardless of its inputs' style). Without this, a
  // forward-slash-configured `staticDir` would never match its own
  // backslash-joined children on Windows, breaking static serving entirely.
  const staticDir = normalize(staticDirRaw);
  // Reject any path that normalizes outside staticDir (path traversal).
  const relative = normalize(reqPath).replace(/^([.]{2}[/\\])+/, "");
  const filePath = join(staticDir, relative);
  if (!filePath.startsWith(staticDir + sep) && filePath !== staticDir) {
    return false;
  }
  try {
    const stats = await stat(filePath);
    if (!stats.isFile()) return false;
    const body = await readFile(filePath);
    const contentType = MIME_TYPES[extname(filePath)] ?? "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType, "Content-Length": body.length });
    res.end(body);
    return true;
  } catch {
    return false;
  }
}

/**
 * Serves the PWA. Dev: reverse-proxies everything to `devUpstream`
 * unchanged (the already-running vite dev server owns its own routing).
 * Prod: serves `staticDir`, with a **real** 404 for a missing asset-looking
 * path rather than the SPA-fallback trap.
 */
export function createStaticAppHandler(params: {
  readonly devUpstream: string | null;
  readonly staticDir: string | null;
}): (req: IncomingMessage, res: ServerResponse) => void {
  if (params.devUpstream !== null) {
    return createPassthroughHandler({ prefix: "", upstreamBaseUrl: params.devUpstream });
  }
  const staticDir = params.staticDir;
  if (staticDir === null) {
    return (_req, res) => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "NO_STATIC_DIR_CONFIGURED" }));
    };
  }
  return (req, res) => {
    void (async () => {
      const reqPath = (req.url ?? "/").split("?")[0];
      if (await serveStaticFile(staticDir, reqPath, res)) return;

      if (looksLikeAssetPath(reqPath)) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Not Found");
        return;
      }

      // Client-side route - fall back to index.html.
      if (await serveStaticFile(staticDir, "/index.html", res)) return;
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "INDEX_HTML_MISSING" }));
    })();
  };
}
