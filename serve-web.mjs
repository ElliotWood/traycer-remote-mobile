/**
 * Scratch harness, not part of the build. Serves `clients/mobile/dist/web`
 * on http://localhost so the multi-host switcher can be exercised against
 * TWO REAL HOSTS at once:
 *
 *   - Tonberry, at ws://127.0.0.1:<port>/rpc
 *   - Altra, at wss://<fqdn>/rpc
 *
 * It must be http://localhost specifically. An https:// page cannot open a
 * ws://127.0.0.1 socket - the browser blocks it as mixed content - so the
 * deployed origin can never reach the local host. localhost is exempt.
 *
 * `/authn` is proxied server-side because production authn's CORS allowlist
 * contains exactly one origin, so a browser on any other origin cannot call
 * it directly. Same allowlist posture as the VM's nginx: four endpoints,
 * not an open relay.
 *
 *   node serve-web.mjs [port]
 */
import { createServer } from "node:http";
import { request as httpsRequest } from "node:https";
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, extname, normalize, sep } from "node:path";

const PORT = Number(process.argv[2] ?? 5299);
const ROOT = normalize(join(import.meta.dirname, "clients", "mobile", "dist", "web"));
const AUTHN_HOST = "authn.traycer.ai";

/**
 * The local host's live endpoint. Read PER REQUEST, never captured: the
 * host picks a fresh port on every restart, so a value captured at build
 * (or even at serve) time is stale the first time it bounces - which is the
 * difference between a setup that works once and one that keeps working.
 * The hostId is stable across restarts; only the port moves.
 */
const PID_JSON = join(homedir(), ".traycer", "host", "pid.json");

/**
 * Extra hosts to offer by default, so nothing has to be typed. Read from a
 * runtime file rather than baked in - an FQDN in a tracked file is both a
 * leak and a fact that goes stale silently.
 */
const HOSTS_CONFIG =
  process.env.TRAYCER_WEB_HOSTS_CONFIG ??
  join(homedir(), ".traycer", "chat-transfer.hosts.json");

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

/** `GET /__traycer/dev-host` - what the app's baked entry is refreshed from. */
async function serveDevHost(res) {
  const pid = await readJson(PID_JSON);
  if (pid === null) {
    // 404, not an invented endpoint: the app falls back to its baked entry,
    // and a fabricated one would be dialled and fail with no explanation.
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "NO_PID_JSON" }));
    return;
  }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      hostId: pid.hostId,
      version: pid.version,
      websocketUrl: pid.websocketUrl,
    }),
  );
}

/** `GET /__traycer/hosts` - default extra hosts, merged into the picker. */
async function serveDefaultHosts(res) {
  const config = await readJson(HOSTS_CONFIG);
  const hosts = Array.isArray(config?.hosts) ? config.hosts : [];
  const entries = hosts
    .filter(
      (h) =>
        typeof h?.hostId === "string" &&
        typeof h?.origin === "string" &&
        h.hostId.length > 0,
    )
    .map((h) => ({
      hostId: h.hostId,
      label: typeof h.alias === "string" && h.alias.length > 0 ? h.alias : h.hostId,
      // The config stores an ORIGIN; the client dials the /rpc path on it.
      websocketUrl: `${h.origin.replace(/\/+$/, "")}/rpc`,
    }));
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(entries));
}

// Exactly what the PWA calls. `auth/exchange-code` is absent on purpose -
// that is the desktop-only PKCE callback.
const AUTHN_ALLOWLIST = new Set([
  "api/v3/user",
  "api/v3/auth/refresh",
  "api/v3/auth/device/authorize",
  "api/v3/auth/device/token",
]);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function proxyAuthn(req, res, suffix) {
  if (!AUTHN_ALLOWLIST.has(suffix.split("?")[0])) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "NOT_ALLOWLISTED" }));
    return;
  }
  const headers = { ...req.headers, host: AUTHN_HOST };
  delete headers.origin;
  delete headers.referer;
  const upstream = httpsRequest(
    { host: AUTHN_HOST, path: `/${suffix}`, method: req.method, headers },
    (upstreamRes) => {
      const out = { ...upstreamRes.headers };
      // The browser is same-origin with us, so upstream CORS headers are
      // noise at best and contradictory at worst.
      for (const key of Object.keys(out)) {
        if (key.toLowerCase().startsWith("access-control-")) delete out[key];
      }
      res.writeHead(upstreamRes.statusCode ?? 502, out);
      upstreamRes.pipe(res);
    },
  );
  upstream.on("error", (error) => {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "UPSTREAM", detail: error.message }));
  });
  req.pipe(upstream);
}

async function serveStatic(res, urlPath) {
  const relative = normalize(urlPath).replace(/^([.]{2}[/\\])+/, "");
  const filePath = join(ROOT, relative);
  if (!filePath.startsWith(ROOT + sep) && filePath !== ROOT) return false;
  try {
    const stats = await stat(filePath);
    if (!stats.isFile()) return false;
    const body = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": MIME[extname(filePath)] ?? "application/octet-stream",
      "Content-Length": body.length,
    });
    res.end(body);
    return true;
  } catch {
    return false;
  }
}

createServer((req, res) => {
  void (async () => {
    const url = req.url ?? "/";
    if (url.startsWith("/authn/")) {
      proxyAuthn(req, res, url.slice("/authn/".length));
      return;
    }
    if (url.split("?")[0] === "/__traycer/dev-host") {
      await serveDevHost(res);
      return;
    }
    if (url.split("?")[0] === "/__traycer/hosts") {
      await serveDefaultHosts(res);
      return;
    }
    const path = url.split("?")[0];
    if (await serveStatic(res, path)) return;
    // A missing asset must 404, not fall back to index.html - an SPA
    // fallback turns a clean 404 into an opaque module-parse error.
    if ((path.split("/").pop() ?? "").includes(".")) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
      return;
    }
    if (await serveStatic(res, "/index.html")) return;
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("index.html missing - run the vite web build first");
  })();
}).listen(PORT, "127.0.0.1", () => {
  console.log(`[serve-web] http://localhost:${PORT}  root=${ROOT}`);
});
