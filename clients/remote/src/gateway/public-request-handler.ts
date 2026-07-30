import type { IncomingMessage, ServerResponse } from "node:http";
import { handleGetHosts } from "./hosts-endpoint";
import { createPassthroughHandler } from "./passthrough";
import { createStaticAppHandler } from "./static-app";
import type { Registry } from "./registry";
import type { GatewayConfig } from "./config";

/**
 * The public listener's plain-HTTP (non-upgrade) request router - split
 * out from `run-gateway.ts` so the routing decisions themselves (which
 * paths go where, and which are explicitly rejected) are unit-testable
 * without spawning the whole process. WS-upgrade routing lives separately
 * in `proxy.ts`'s `attachProxy` (Node fires `upgrade`, not `request`, for
 * those).
 */
export function createPublicRequestHandler(
  config: GatewayConfig,
  registry: Registry,
): (req: IncomingMessage, res: ServerResponse) => void {
  const authnPassthrough = createPassthroughHandler({
    prefix: "/authn",
    upstreamBaseUrl: config.authnUpstream,
  });
  const pushPassthrough = createPassthroughHandler({
    prefix: "/push",
    upstreamBaseUrl: config.pushUpstream,
  });
  const staticApp = createStaticAppHandler({
    devUpstream: config.devUpstream,
    staticDir: config.staticDir,
  });

  return (req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    if (req.method === "GET" && path === "/hosts") {
      void handleGetHosts(req, res, registry, config);
      return;
    }
    if (path.startsWith("/authn")) {
      authnPassthrough(req, res);
      return;
    }
    if (path.startsWith("/push")) {
      pushPassthrough(req, res);
      return;
    }
    // The registration/heartbeat/unregister routes belong ONLY to the
    // internal listener (rubric §3: not open to the network). Without this
    // explicit rejection, a request here would silently fall through to
    // the static app handler and get served `index.html` with a `200` -
    // not a hang, but not the clean 404/refused the check requires either,
    // and a misleading response for a route that must never be reachable
    // from the public surface at all. Caught by a real smoke test before
    // handoff, not assumed - see the regression test in
    // `__tests__/public-request-handler.test.ts`.
    if (path.startsWith("/agents/")) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "NOT_FOUND" }));
      return;
    }
    staticApp(req, res);
  };
}
