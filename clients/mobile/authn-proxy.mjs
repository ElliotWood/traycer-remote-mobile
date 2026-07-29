// Same-origin /authn reverse proxy for the tailnet rig.
//
// Production authn's CORS allowlist contains exactly one origin
// (https://platform.traycer.ai), so a browser on any other origin cannot call
// it directly — every sign-in fails with an opaque CORS error. The client is
// therefore built with VITE_AUTHN_BASE_URL=/authn and this process forwards
// that path server-side, where CORS does not apply.
//
// This mirrors what `vite.config.ts`'s dev-server proxy does, but survives into
// the production build, which `vite preview` does not (server.proxy is
// dev-only). It is rig scaffolding, not product: the real D4 answer is the
// Traycer host serving the bundle and proxying /authn itself.
//
// Usage: node authn-proxy.mjs [listenPort] [upstreamOrigin]
import { createServer } from "node:http";

const LISTEN_PORT = Number(process.argv[2] ?? 5277);
const UPSTREAM = process.argv[3] ?? "https://authn.traycer.ai";
const PREFIX = "/authn";

const server = createServer(async (req, res) => {
  // tailscale serve may or may not strip the mount prefix depending on how the
  // route is registered, so tolerate both rather than guessing.
  const rawPath = req.url ?? "/";
  const path = rawPath.startsWith(PREFIX) ? rawPath.slice(PREFIX.length) || "/" : rawPath;
  const target = new URL(path, UPSTREAM);

  const headers = { ...req.headers };
  // Upstream must see its own host, and must not see our origin — sending a
  // foreign Origin is what triggers the CORS rejection we exist to avoid.
  delete headers.host;
  delete headers.origin;
  delete headers.referer;
  delete headers["accept-encoding"];

  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;

  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
      redirect: "manual",
    });
    const buf = Buffer.from(await upstream.arrayBuffer());
    const out = {};
    upstream.headers.forEach((v, k) => {
      // Strip upstream CORS headers: the browser sees this as same-origin, so
      // any Access-Control-Allow-Origin naming a different host would break it.
      if (k.toLowerCase().startsWith("access-control-")) return;
      if (k.toLowerCase() === "content-encoding") return;
      out[k] = v;
    });
    res.writeHead(upstream.status, out);
    res.end(buf);
    console.error(`[authn-proxy] ${req.method} ${path} -> ${upstream.status}`);
  } catch (err) {
    console.error(`[authn-proxy] ${req.method} ${path} -> ERROR ${String(err)}`);
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "authn proxy upstream failure" }));
  }
});

server.listen(LISTEN_PORT, "127.0.0.1", () => {
  console.error(`[authn-proxy] listening on 127.0.0.1:${LISTEN_PORT} -> ${UPSTREAM}`);
});
