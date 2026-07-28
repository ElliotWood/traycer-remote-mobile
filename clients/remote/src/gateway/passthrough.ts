import http from "node:http";
import https from "node:https";
import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * Plain reverse-proxy for `/authn` and `/push`: strips the given prefix,
 * forwards method/headers/body to `upstreamBaseUrl`, streams the response
 * back unchanged. A connection-refused upstream (e.g. `/push` before the
 * push service is up - expected this sprint, per the Planner) maps to a
 * clean `502`, never a hang.
 */
export function createPassthroughHandler(params: {
  readonly prefix: string;
  readonly upstreamBaseUrl: string;
}): (req: IncomingMessage, res: ServerResponse) => void {
  const upstream = new URL(params.upstreamBaseUrl);
  const client = upstream.protocol === "https:" ? https : http;

  return (req, res) => {
    const forwardedPath = (req.url ?? "/").slice(params.prefix.length) || "/";
    const targetUrl = new URL(forwardedPath, upstream);

    const proxyReq = client.request(
      targetUrl,
      {
        method: req.method,
        headers: { ...req.headers, host: targetUrl.host },
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
        proxyRes.pipe(res);
      },
    );
    proxyReq.on("error", () => {
      if (!res.headersSent) {
        res.writeHead(502, { "Content-Type": "application/json" });
      }
      res.end(JSON.stringify({ error: "UPSTREAM_UNREACHABLE" }));
    });
    req.pipe(proxyReq);
  };
}
